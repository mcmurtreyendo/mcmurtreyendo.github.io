import argparse
import json
import os
from pathlib import Path

import cv2
import numpy as np


def load_display_image(path: str) -> np.ndarray:
    image = cv2.imread(path, cv2.IMREAD_COLOR)

    if image is None:
        raise FileNotFoundError(f"Could not load display image: {path}")

    return image


def load_filled_mask(path: str, threshold: int = 80) -> np.ndarray:
    """
    Loads a filled tooth mask.

    Expected:
    - black background
    - solid white teeth
    - no labels
    - no numbers
    - no guide lines
    """

    image = cv2.imread(path, cv2.IMREAD_UNCHANGED)

    if image is None:
        raise FileNotFoundError(f"Could not load mask image: {path}")

    if len(image.shape) == 3 and image.shape[2] == 4:
        bgr = image[:, :, :3]
        alpha = image[:, :, 3]
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

        mask = np.where((alpha > 10) & (gray > threshold), 255, 0).astype(np.uint8)

    elif len(image.shape) == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        _, mask = cv2.threshold(gray, threshold, 255, cv2.THRESH_BINARY)

    else:
        _, mask = cv2.threshold(image, threshold, 255, cv2.THRESH_BINARY)

    return mask


def validate_same_size(display: np.ndarray, mask: np.ndarray) -> None:
    display_height, display_width = display.shape[:2]
    mask_height, mask_width = mask.shape[:2]

    if (display_width, display_height) != (mask_width, mask_height):
        raise ValueError(
            "Display image and mask image must be the same size.\n"
            f"Display: {display_width} x {display_height}\n"
            f"Mask:    {mask_width} x {mask_height}"
        )


def clean_mask(mask: np.ndarray, close_size: int = 3, open_size: int = 0) -> np.ndarray:
    """
    Cleans the filled mask.

    close_size fills small holes.
    open_size removes tiny specks. Leave open_size at 0 unless needed.
    """

    cleaned = mask.copy()

    if close_size > 0:
        close_kernel = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE,
            (close_size, close_size),
        )
        cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, close_kernel, iterations=1)

    if open_size > 0:
        open_kernel = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE,
            (open_size, open_size),
        )
        cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_OPEN, open_kernel, iterations=1)

    return cleaned


def find_connected_teeth(
    mask: np.ndarray,
    min_width: int,
    min_height: int,
    max_width: int,
    max_height: int,
    min_area: int,
    max_area: int,
) -> list[dict]:
    """
    Detects each white connected component as one tooth candidate.
    """

    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(
        mask,
        connectivity=8,
    )

    boxes = []

    for label_id in range(1, num_labels):
        x = int(stats[label_id, cv2.CC_STAT_LEFT])
        y = int(stats[label_id, cv2.CC_STAT_TOP])
        w = int(stats[label_id, cv2.CC_STAT_WIDTH])
        h = int(stats[label_id, cv2.CC_STAT_HEIGHT])
        area = int(stats[label_id, cv2.CC_STAT_AREA])

        if w < min_width:
            continue

        if h < min_height:
            continue

        if w > max_width:
            continue

        if h > max_height:
            continue

        if area < min_area:
            continue

        if area > max_area:
            continue

        boxes.append(
            {
                "x": x,
                "y": y,
                "width": w,
                "height": h,
                "center_x": int(centroids[label_id][0]),
                "center_y": int(centroids[label_id][1]),
                "area": area,
            }
        )

    return boxes


def group_rows(boxes: list[dict], row_tolerance: int = 120) -> list[list[dict]]:
    """
    Groups boxes into visual rows.
    """

    if not boxes:
        return []

    sorted_boxes = sorted(boxes, key=lambda b: b["center_y"])
    rows = []

    for box in sorted_boxes:
        placed = False

        for row in rows:
            row_center_y = sum(b["center_y"] for b in row) / len(row)

            if abs(box["center_y"] - row_center_y) <= row_tolerance:
                row.append(box)
                placed = True
                break

        if not placed:
            rows.append([box])

    rows.sort(key=lambda row: sum(b["center_y"] for b in row) / len(row))

    for row in rows:
        row.sort(key=lambda b: b["center_x"])

    return rows


def split_box_at_x(box: dict, split_x: int, split_gap: int = 4) -> tuple[dict, dict]:
    """
    Splits a wide box into two boxes at an image x-coordinate.
    """

    x = box["x"]
    y = box["y"]
    w = box["width"]
    h = box["height"]

    x2 = x + w

    left_width = max(1, split_x - x - split_gap)
    right_x = split_x + split_gap
    right_width = max(1, x2 - right_x)

    left = dict(box)
    left["x"] = x
    left["width"] = left_width
    left["center_x"] = left["x"] + left["width"] // 2
    left["center_y"] = y + h // 2
    left["area"] = int(box.get("area", 0) / 2)

    right = dict(box)
    right["x"] = right_x
    right["width"] = right_width
    right["center_x"] = right["x"] + right["width"] // 2
    right["center_y"] = y + h // 2
    right["area"] = int(box.get("area", 0) / 2)

    return left, right


def find_best_vertical_split(mask: np.ndarray, box: dict) -> int:
    """
    Finds the best vertical split point inside a wide merged tooth component.

    It looks for the thinnest white column near the center of the merged box.
    This is better than blindly splitting exactly in half.
    """

    x = box["x"]
    y = box["y"]
    w = box["width"]
    h = box["height"]

    crop = mask[y : y + h, x : x + w]

    if crop.size == 0:
        return x + w // 2

    x_projection = np.count_nonzero(crop, axis=0)

    center = w // 2

    search_radius = max(10, int(w * 0.25))
    search_start = max(0, center - search_radius)
    search_end = min(w - 1, center + search_radius)

    search_values = x_projection[search_start : search_end + 1]

    if len(search_values) == 0:
        return x + center

    local_split_index = int(np.argmin(search_values))
    split_x_inside_box = search_start + local_split_index

    return x + split_x_inside_box


def split_wide_boxes_by_row(
    boxes: list[dict],
    mask: np.ndarray,
    row_tolerance: int = 120,
    wide_ratio: float = 1.65,
    min_split_width: int = 180,
    split_gap: int = 4,
) -> list[dict]:
    """
    Splits boxes that are suspiciously wide compared to the other boxes in the same row.

    This handles cases where two filled teeth touch each other and OpenCV detects them
    as one connected component.
    """

    rows = group_rows(boxes, row_tolerance=row_tolerance)
    output = []

    for row_index, row in enumerate(rows, start=1):
        widths = [box["width"] for box in row]

        if not widths:
            continue

        median_width = float(np.median(widths))

        for box in row:
            is_wide = (
                box["width"] >= min_split_width
                and box["width"] >= median_width * wide_ratio
            )

            if not is_wide:
                output.append(box)
                continue

            split_x = find_best_vertical_split(mask, box)
            left, right = split_box_at_x(box, split_x, split_gap=split_gap)

            output.append(left)
            output.append(right)

            print(
                f"Auto-split wide component in row {row_index}: "
                f"x={box['x']}, y={box['y']}, w={box['width']}, h={box['height']} "
                f"at x={split_x}"
            )

    return output


def assign_ids(boxes: list[dict], row_tolerance: int = 120) -> list[dict]:
    """
    Assigns IDs in visual order:
    top row left-to-right, then bottom row left-to-right.
    """

    rows = group_rows(boxes, row_tolerance=row_tolerance)

    output = []
    counter = 1

    for row_index, row in enumerate(rows, start=1):
        for column_index, box in enumerate(row, start=1):
            new_box = dict(box)
            new_box["id"] = f"tooth_{counter:03d}"
            new_box["label"] = f"{counter:03d}"
            new_box["row"] = row_index
            new_box["column"] = column_index
            output.append(new_box)
            counter += 1

    return output


def pad_boxes(
    boxes: list[dict],
    image_width: int,
    image_height: int,
    pad_x: int,
    pad_y: int,
) -> list[dict]:
    padded = []

    for box in boxes:
        x1 = max(0, box["x"] - pad_x)
        y1 = max(0, box["y"] - pad_y)

        x2 = min(image_width - 1, box["x"] + box["width"] + pad_x)
        y2 = min(image_height - 1, box["y"] + box["height"] + pad_y)

        new_box = dict(box)
        new_box["x"] = int(x1)
        new_box["y"] = int(y1)
        new_box["width"] = int(x2 - x1)
        new_box["height"] = int(y2 - y1)

        padded.append(new_box)

    return padded


def write_json(
    boxes: list[dict],
    image_width: int,
    image_height: int,
    output_path: str,
) -> None:
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
                "row": box["row"],
                "column": box["column"],

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


def draw_preview(
    display: np.ndarray,
    boxes: list[dict],
    output_path: str,
) -> None:
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
            (x, max(30, y - 8)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (0, 255, 0),
            2,
            cv2.LINE_AA,
        )

    cv2.imwrite(output_path, preview)


def write_html(
    display_image_path: str,
    boxes: list[dict],
    image_width: int,
    image_height: int,
    output_path: str,
) -> None:
    image_name = os.path.basename(display_image_path)

    button_html = []

    for box in boxes:
        left = box["x"] / image_width * 100
        top = box["y"] / image_height * 100
        width = box["width"] / image_width * 100
        height = box["height"] / image_height * 100

        button_html.append(
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

        {"".join(button_html)}
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
    parser = argparse.ArgumentParser(
        description="Detect clickable tooth boxes from a solid filled tooth mask."
    )

    parser.add_argument(
        "--display",
        required=True,
        help="Original image shown in the browser.",
    )

    parser.add_argument(
        "--mask",
        required=True,
        help="Filled white tooth mask used for detection.",
    )

    parser.add_argument(
        "--out-dir",
        default="output_filled_teeth",
        help="Output folder.",
    )

    parser.add_argument("--threshold", type=int, default=80)

    parser.add_argument(
        "--close-size",
        type=int,
        default=3,
        help="Morphological close size. Helps fill tiny holes.",
    )

    parser.add_argument(
        "--open-size",
        type=int,
        default=0,
        help="Morphological open size. Helps remove tiny specks. Usually keep at 0.",
    )

    parser.add_argument("--min-width", type=int, default=40)
    parser.add_argument("--min-height", type=int, default=80)
    parser.add_argument("--max-width", type=int, default=500)
    parser.add_argument("--max-height", type=int, default=600)
    parser.add_argument("--min-area", type=int, default=2500)
    parser.add_argument("--max-area", type=int, default=200000)

    parser.add_argument(
        "--row-tolerance",
        type=int,
        default=120,
        help="How close vertical centers must be to count as the same row.",
    )

    parser.add_argument(
        "--auto-split-wide",
        action="store_true",
        help="Automatically split suspiciously wide components.",
    )

    parser.add_argument(
        "--wide-ratio",
        type=float,
        default=1.65,
        help="How much wider than row median a component must be before splitting.",
    )

    parser.add_argument(
        "--min-split-width",
        type=int,
        default=180,
        help="Minimum width before a component is allowed to be split.",
    )

    parser.add_argument(
        "--split-gap",
        type=int,
        default=4,
        help="Black gap size to create between auto-split boxes.",
    )

    parser.add_argument("--pad-x", type=int, default=0)
    parser.add_argument("--pad-y", type=int, default=0)

    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    display = load_display_image(args.display)
    mask = load_filled_mask(args.mask, threshold=args.threshold)

    validate_same_size(display, mask)

    mask = clean_mask(
        mask,
        close_size=args.close_size,
        open_size=args.open_size,
    )

    image_height, image_width = mask.shape[:2]

    boxes = find_connected_teeth(
        mask,
        min_width=args.min_width,
        min_height=args.min_height,
        max_width=args.max_width,
        max_height=args.max_height,
        min_area=args.min_area,
        max_area=args.max_area,
    )

    print(f"Initial connected components detected: {len(boxes)}")

    if args.auto_split_wide:
        boxes = split_wide_boxes_by_row(
            boxes,
            mask=mask,
            row_tolerance=args.row_tolerance,
            wide_ratio=args.wide_ratio,
            min_split_width=args.min_split_width,
            split_gap=args.split_gap,
        )

        print(f"After auto-splitting wide components: {len(boxes)}")

    boxes = assign_ids(
        boxes,
        row_tolerance=args.row_tolerance,
    )

    boxes = pad_boxes(
        boxes,
        image_width=image_width,
        image_height=image_height,
        pad_x=args.pad_x,
        pad_y=args.pad_y,
    )

    json_path = out_dir / "teeth_boxes_filled.json"
    preview_path = out_dir / "teeth_boxes_filled_preview.png"
    html_path = out_dir / "teeth_buttons_filled.html"
    cleaned_mask_path = out_dir / "cleaned_filled_mask.png"

    write_json(
        boxes,
        image_width=image_width,
        image_height=image_height,
        output_path=str(json_path),
    )

    draw_preview(
        display,
        boxes,
        output_path=str(preview_path),
    )

    write_html(
        display_image_path=args.display,
        boxes=boxes,
        image_width=image_width,
        image_height=image_height,
        output_path=str(html_path),
    )

    cv2.imwrite(str(cleaned_mask_path), mask)

    print()
    print(f"Final tooth boxes: {len(boxes)}")
    print(f"JSON:    {json_path}")
    print(f"Preview: {preview_path}")
    print(f"HTML:    {html_path}")
    print(f"Mask:    {cleaned_mask_path}")

    if len(boxes) != 32:
        print()
        print("WARNING: Expected 32 adult teeth, but detected a different count.")
        print("If count is too low, some teeth may be touching in the mask.")
        print("If count is too high, there may be leftover white junk in the mask.")


if __name__ == "__main__":
    main()