import argparse
import json
import os
from pathlib import Path

import cv2
import numpy as np


def load_binary_image(image_path: str, threshold: int = 80) -> tuple[np.ndarray, np.ndarray]:
    """
    Load image and convert visible/bright pixels to a binary mask.
    White = tooth pixels
    Black = background
    """

    img = cv2.imread(image_path, cv2.IMREAD_UNCHANGED)

    if img is None:
        raise FileNotFoundError(f"Could not load image: {image_path}")

    if len(img.shape) == 3 and img.shape[2] == 4:
        bgr = img[:, :, :3]
        alpha = img[:, :, 3]
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

        mask = np.where((alpha > 10) & (gray > threshold), 255, 0).astype(np.uint8)
        display = bgr

    elif len(img.shape) == 3:
        display = img
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        _, mask = cv2.threshold(gray, threshold, 255, cv2.THRESH_BINARY)

    else:
        gray = img
        display = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
        _, mask = cv2.threshold(gray, threshold, 255, cv2.THRESH_BINARY)

    return display, mask


def smooth_mask(mask: np.ndarray) -> np.ndarray:
    """
    Slightly thicken the tooth strokes so projection detection is more stable.
    This does NOT need teeth to become one connected component.
    """

    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    thickened = cv2.dilate(mask, kernel, iterations=1)

    return thickened


def find_runs(values: np.ndarray, min_value: int, min_length: int, gap_tolerance: int = 0) -> list[tuple[int, int]]:
    """
    Finds continuous ranges where values are above min_value.

    gap_tolerance lets small empty gaps be included inside a run.
    """

    runs = []
    in_run = False
    start = 0
    last_good = 0
    gap_count = 0

    for i, value in enumerate(values):
        if value >= min_value:
            if not in_run:
                start = i
                in_run = True

            last_good = i
            gap_count = 0

        else:
            if in_run:
                gap_count += 1

                if gap_count > gap_tolerance:
                    end = last_good

                    if end - start + 1 >= min_length:
                        runs.append((start, end))

                    in_run = False
                    gap_count = 0

    if in_run:
        end = last_good

        if end - start + 1 >= min_length:
            runs.append((start, end))

    return runs


def merge_close_runs(runs: list[tuple[int, int]], max_gap: int) -> list[tuple[int, int]]:
    """
    Merges runs that are close together.
    """

    if not runs:
        return []

    merged = [runs[0]]

    for start, end in runs[1:]:
        prev_start, prev_end = merged[-1]

        if start - prev_end <= max_gap:
            merged[-1] = (prev_start, end)
        else:
            merged.append((start, end))

    return merged


def detect_rows(mask: np.ndarray) -> list[tuple[int, int]]:
    """
    Detect horizontal tooth rows using Y projection.
    """

    height, width = mask.shape[:2]

    y_projection = np.count_nonzero(mask, axis=1)

    # A row has enough white pixels across the width.
    row_threshold = max(20, int(width * 0.01))

    rows = find_runs(
        y_projection,
        min_value=row_threshold,
        min_length=80,
        gap_tolerance=25,
    )

    rows = merge_close_runs(rows, max_gap=35)

    return rows


def detect_teeth_in_row(
    mask: np.ndarray,
    row_start: int,
    row_end: int,
    min_tooth_width: int = 35,
    min_tooth_height: int = 80,
    gap_tolerance: int = 20,
) -> list[dict]:
    """
    Within a row, detect tooth columns using X projection.
    """

    row_mask = mask[row_start:row_end + 1, :]
    row_height, image_width = row_mask.shape[:2]

    x_projection = np.count_nonzero(row_mask, axis=0)

    # A tooth column only needs a few white pixels vertically because the drawing is an outline.
    column_threshold = max(5, int(row_height * 0.04))

    column_runs = find_runs(
        x_projection,
        min_value=column_threshold,
        min_length=min_tooth_width,
        gap_tolerance=gap_tolerance,
    )

    boxes = []

    for x1, x2 in column_runs:
        tooth_crop = row_mask[:, x1:x2 + 1]

        ys, xs = np.where(tooth_crop > 0)

        if len(xs) == 0 or len(ys) == 0:
            continue

        tight_x1 = x1 + int(xs.min())
        tight_x2 = x1 + int(xs.max())
        tight_y1 = row_start + int(ys.min())
        tight_y2 = row_start + int(ys.max())

        w = tight_x2 - tight_x1 + 1
        h = tight_y2 - tight_y1 + 1

        if w < min_tooth_width:
            continue

        if h < min_tooth_height:
            continue

        boxes.append(
            {
                "x": int(tight_x1),
                "y": int(tight_y1),
                "width": int(w),
                "height": int(h),
                "center_x": int(tight_x1 + w / 2),
                "center_y": int(tight_y1 + h / 2),
            }
        )

    return boxes


def pad_box(box: dict, pad_x: int, pad_y: int, image_width: int, image_height: int) -> dict:
    """
    Expands box slightly so the click area feels better.
    """

    x = max(0, box["x"] - pad_x)
    y = max(0, box["y"] - pad_y)

    x2 = min(image_width - 1, box["x"] + box["width"] + pad_x)
    y2 = min(image_height - 1, box["y"] + box["height"] + pad_y)

    return {
        **box,
        "x": int(x),
        "y": int(y),
        "width": int(x2 - x),
        "height": int(y2 - y),
    }


def assign_ids(boxes: list[dict]) -> list[dict]:
    """
    Sort boxes top-to-bottom, then left-to-right.
    """

    boxes = sorted(boxes, key=lambda b: (b["center_y"], b["center_x"]))

    output = []

    for i, box in enumerate(boxes, start=1):
        new_box = dict(box)
        new_box["id"] = f"tooth_{i:03d}"
        new_box["label"] = f"{i:03d}"
        output.append(new_box)

    return output


def write_json(boxes: list[dict], image_width: int, image_height: int, output_path: str) -> None:
    data = {
        "image_width": image_width,
        "image_height": image_height,
        "boxes": [],
    }

    for box in boxes:
        x = box["x"]
        y = box["y"]
        w = box["width"]
        h = box["height"]

        data["boxes"].append(
            {
                "id": box["id"],
                "label": box["label"],
                "x": x,
                "y": y,
                "width": w,
                "height": h,
                "x_percent": x / image_width * 100,
                "y_percent": y / image_height * 100,
                "width_percent": w / image_width * 100,
                "height_percent": h / image_height * 100,
            }
        )

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4)


def draw_preview(display: np.ndarray, boxes: list[dict], output_path: str) -> None:
    preview = display.copy()

    for box in boxes:
        x = box["x"]
        y = box["y"]
        w = box["width"]
        h = box["height"]

        cv2.rectangle(preview, (x, y), (x + w, y + h), (0, 255, 0), 3)

        cv2.putText(
            preview,
            box["label"],
            (x, max(25, y - 8)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (0, 255, 0),
            2,
            cv2.LINE_AA,
        )

    cv2.imwrite(output_path, preview)


def write_html(image_path: str, boxes: list[dict], image_width: int, image_height: int, output_path: str) -> None:
    image_name = os.path.basename(image_path)

    buttons = []

    for box in boxes:
        left = box["x"] / image_width * 100
        top = box["y"] / image_height * 100
        width = box["width"] / image_width * 100
        height = box["height"] / image_height * 100

        buttons.append(
            f"""
            <button
                class="tooth-button"
                data-tooth="{box["id"]}"
                style="
                    left: {left:.4f}%;
                    top: {top:.4f}%;
                    width: {width:.4f}%;
                    height: {height:.4f}%;
                "
                onclick="selectTooth('{box["id"]}')"
                title="{box["label"]}">
            </button>
            """
        )

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Clickable Tooth Chart</title>

    <style>
        body {{
            background: #111;
            color: white;
            font-family: Arial, sans-serif;
            padding: 24px;
        }}

        .chart-wrapper {{
            position: relative;
            display: inline-block;
            max-width: 100%;
        }}

        .chart-wrapper img {{
            display: block;
            max-width: 100%;
            height: auto;
            user-select: none;
        }}

        .tooth-button {{
            position: absolute;
            border: 2px solid rgba(0, 255, 0, 0.35);
            background: rgba(0, 255, 0, 0.04);
            cursor: pointer;
            padding: 0;
            margin: 0;
        }}

        .tooth-button:hover {{
            background: rgba(0, 255, 0, 0.25);
            border-color: rgba(0, 255, 0, 1);
        }}

        .tooth-button.selected {{
            background: rgba(255, 215, 0, 0.35);
            border-color: rgba(255, 215, 0, 1);
        }}

        #output {{
            margin-top: 18px;
            font-size: 18px;
        }}
    </style>
</head>

<body>
    <h1>Clickable Tooth Chart</h1>

    <div class="chart-wrapper">
        <img src="{image_name}" alt="Tooth chart">

        {"".join(buttons)}
    </div>

    <div id="output">Click a tooth.</div>

    <script>
        function selectTooth(toothId) {{
            const button = document.querySelector(`[data-tooth="${{toothId}}"]`);

            if (!button) return;

            button.classList.toggle("selected");

            const selected = [...document.querySelectorAll(".tooth-button.selected")]
                .map(btn => btn.dataset.tooth);

            document.getElementById("output").textContent =
                selected.length
                    ? "Selected: " + selected.join(", ")
                    : "Click a tooth.";
        }}
    </script>
</body>
</html>
"""

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html)


def main():
    parser = argparse.ArgumentParser(description="Detect whole tooth boxes using projection segmentation.")

    parser.add_argument("image", help="Cleaned tooth image.")
    parser.add_argument("--out-dir", default="output_teeth_projection")

    parser.add_argument("--threshold", type=int, default=80)

    parser.add_argument("--min-tooth-width", type=int, default=45)
    parser.add_argument("--min-tooth-height", type=int, default=120)
    parser.add_argument("--gap-tolerance", type=int, default=35)

    parser.add_argument("--pad-x", type=int, default=10)
    parser.add_argument("--pad-y", type=int, default=10)

    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    display, mask = load_binary_image(args.image, threshold=args.threshold)
    mask = smooth_mask(mask)

    image_height, image_width = mask.shape[:2]

    rows = detect_rows(mask)

    all_boxes = []

    print(f"Detected {len(rows)} rows:")
    for i, (y1, y2) in enumerate(rows, start=1):
        print(f"  Row {i}: y={y1} to y={y2}, height={y2 - y1 + 1}")

        row_boxes = detect_teeth_in_row(
            mask,
            y1,
            y2,
            min_tooth_width=args.min_tooth_width,
            min_tooth_height=args.min_tooth_height,
            gap_tolerance=args.gap_tolerance,
        )

        print(f"    Teeth in row: {len(row_boxes)}")

        all_boxes.extend(row_boxes)

    padded_boxes = [
        pad_box(
            box,
            pad_x=args.pad_x,
            pad_y=args.pad_y,
            image_width=image_width,
            image_height=image_height,
        )
        for box in all_boxes
    ]

    boxes = assign_ids(padded_boxes)

    json_path = out_dir / "teeth_boxes_projection.json"
    preview_path = out_dir / "teeth_boxes_projection_preview.png"
    html_path = out_dir / "teeth_buttons_projection.html"
    mask_path = out_dir / "projection_mask.png"

    write_json(boxes, image_width, image_height, str(json_path))
    draw_preview(display, boxes, str(preview_path))
    write_html(args.image, boxes, image_width, image_height, str(html_path))
    cv2.imwrite(str(mask_path), mask)

    print()
    print(f"Detected {len(boxes)} tooth boxes total.")
    print(f"JSON:    {json_path}")
    print(f"Preview: {preview_path}")
    print(f"HTML:    {html_path}")
    print(f"Mask:    {mask_path}")


if __name__ == "__main__":
    main()