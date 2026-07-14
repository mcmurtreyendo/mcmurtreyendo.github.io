import argparse
import json
import os
from pathlib import Path

import cv2
import numpy as np


def load_visible_mask(image_path: str, threshold: int = 20) -> tuple[np.ndarray, np.ndarray]:
    """
    Loads an image and creates a binary mask of visible pixels.

    Works with:
    - PNGs with transparency
    - JPG/PNG images on black backgrounds
    """

    img = cv2.imread(image_path, cv2.IMREAD_UNCHANGED)

    if img is None:
        raise FileNotFoundError(f"Could not load image: {image_path}")

    if len(img.shape) == 3 and img.shape[2] == 4:
        bgr = img[:, :, :3]
        alpha = img[:, :, 3]

        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

        # Keep pixels that are both visible and not basically black
        mask = np.where((alpha > threshold) & (gray > threshold), 255, 0).astype(np.uint8)

    else:
        if len(img.shape) == 2:
            gray = img
            bgr = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
        else:
            bgr = img
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        _, mask = cv2.threshold(gray, threshold, 255, cv2.THRESH_BINARY)

    return bgr, mask


def remove_long_horizontal_lines(mask: np.ndarray, kernel_width: int = 70) -> np.ndarray:
    """
    Removes long horizontal rules/guide lines from the chart.

    Tooth charts often have long horizontal lines running through them.
    Those lines can connect multiple teeth together, so we remove them before contour detection.
    """

    horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kernel_width, 1))
    detected_lines = cv2.morphologyEx(mask, cv2.MORPH_OPEN, horizontal_kernel, iterations=1)

    cleaned = cv2.subtract(mask, detected_lines)
    return cleaned


def connect_tooth_outlines(
    mask: np.ndarray,
    dilate_width: int = 9,
    dilate_height: int = 9,
    dilate_iterations: int = 1,
) -> np.ndarray:
    """
    Connects broken tooth outlines so each tooth becomes one larger object.

    This version works better for cleaned mask images where the teeth are white outlines
    on a black background.
    """

    # First, threshold hard so faint gray pixels do not become random detections.
    _, clean = cv2.threshold(mask, 150, 255, cv2.THRESH_BINARY)

    # Close small gaps in the tooth outlines.
    close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 17))
    connected = cv2.morphologyEx(clean, cv2.MORPH_CLOSE, close_kernel, iterations=1)

    # Thicken the outlines slightly so broken pieces join together.
    dilate_kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE,
        (dilate_width, dilate_height)
    )

    connected = cv2.dilate(
        connected,
        dilate_kernel,
        iterations=dilate_iterations
    )

    return connected

def filter_boxes(
    contours,
    image_width: int,
    image_height: int,
    min_width: int = 14,
    min_height: int = 30,
    max_width: int = 130,
    max_height: int = 170,
    min_area: int = 250,
    max_aspect_ratio: float = 3.0,
) -> list[dict]:
    """
    Converts contours into bounding boxes and filters obvious non-teeth.

    These values are intentionally adjustable because tooth chart images vary.
    """

    boxes = []

    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        area = cv2.contourArea(contour)

        if w < min_width or h < min_height:
            continue

        if w > max_width or h > max_height:
            continue

        if area < min_area:
            continue

        aspect_ratio = w / h

        # Reject long skinny horizontal objects.
        if aspect_ratio > max_aspect_ratio:
            continue

        # Reject objects that are suspiciously close to full image width.
        if w > image_width * 0.2:
            continue

        boxes.append(
            {
                "x": int(x),
                "y": int(y),
                "width": int(w),
                "height": int(h),
                "center_x": int(x + w / 2),
                "center_y": int(y + h / 2),
                "area": float(area),
            }
        )

    return boxes


def group_rows(boxes: list[dict], row_tolerance: int = 45) -> list[list[dict]]:
    """
    Groups detected teeth into rows based on vertical center position.

    This makes numbering easier because teeth are sorted row-by-row,
    left-to-right.
    """

    if not boxes:
        return []

    boxes = sorted(boxes, key=lambda b: b["center_y"])

    rows = []

    for box in boxes:
        placed = False

        for row in rows:
            row_center = sum(b["center_y"] for b in row) / len(row)

            if abs(box["center_y"] - row_center) <= row_tolerance:
                row.append(box)
                placed = True
                break

        if not placed:
            rows.append([box])

    for row in rows:
        row.sort(key=lambda b: b["center_x"])

    rows.sort(key=lambda row: sum(b["center_y"] for b in row) / len(row))

    return rows


def assign_ids(boxes: list[dict], row_tolerance: int = 45) -> list[dict]:
    """
    Assigns simple IDs like tooth_001, tooth_002, etc.

    You can later replace these with real dental numbers.
    """

    rows = group_rows(boxes, row_tolerance=row_tolerance)

    numbered = []
    counter = 1

    for row_index, row in enumerate(rows, start=1):
        for col_index, box in enumerate(row, start=1):
            box = dict(box)
            box["id"] = f"tooth_{counter:03d}"
            box["row"] = row_index
            box["column"] = col_index
            numbered.append(box)
            counter += 1

    return numbered


def draw_preview(image: np.ndarray, boxes: list[dict], output_path: str) -> None:
    """
    Draws detected boxes over the original image.
    """

    preview = image.copy()

    for box in boxes:
        x = box["x"]
        y = box["y"]
        w = box["width"]
        h = box["height"]

        cv2.rectangle(preview, (x, y), (x + w, y + h), (0, 255, 0), 2)

        label = box["id"].replace("tooth_", "")
        cv2.putText(
            preview,
            label,
            (x, max(15, y - 5)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            (0, 255, 0),
            1,
            cv2.LINE_AA,
        )

    cv2.imwrite(output_path, preview)


def write_json(boxes: list[dict], image_width: int, image_height: int, output_path: str) -> None:
    """
    Saves boxes as absolute pixels and percentages.

    Percent values are useful for responsive HTML overlays.
    """

    output = {
        "image_width": image_width,
        "image_height": image_height,
        "boxes": [],
    }

    for box in boxes:
        output["boxes"].append(
            {
                "id": box["id"],
                "row": box["row"],
                "column": box["column"],

                # Pixel coordinates
                "x": box["x"],
                "y": box["y"],
                "width": box["width"],
                "height": box["height"],

                # Percentage coordinates for CSS overlays
                "x_percent": box["x"] / image_width * 100,
                "y_percent": box["y"] / image_height * 100,
                "width_percent": box["width"] / image_width * 100,
                "height_percent": box["height"] / image_height * 100,
            }
        )

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=4)


def write_html(image_path: str, boxes: list[dict], image_width: int, image_height: int, output_path: str) -> None:
    """
    Writes a standalone HTML file where each detected tooth is a clickable button.
    """

    image_name = os.path.basename(image_path)

    button_html = []

    for box in boxes:
        left = box["x"] / image_width * 100
        top = box["y"] / image_height * 100
        width = box["width"] / image_width * 100
        height = box["height"] / image_height * 100

        button_html.append(
            f'''
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
                title="{box["id"]}">
            </button>
            '''
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
            border: 2px solid rgba(0, 255, 0, 0.45);
            background: rgba(0, 255, 0, 0.08);
            cursor: pointer;
            padding: 0;
            margin: 0;
        }}

        .tooth-button:hover {{
            background: rgba(0, 255, 0, 0.28);
            border-color: rgba(0, 255, 0, 0.95);
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

            if (!button) {{
                return;
            }}

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
    parser = argparse.ArgumentParser(description="Detect tooth bounding boxes from a static tooth chart image.")

    parser.add_argument("image", help="Path to the tooth chart image.")

    parser.add_argument("--out-dir", default="output_teeth", help="Output directory.")

    parser.add_argument("--threshold", type=int, default=20, help="Brightness/alpha threshold.")

    parser.add_argument("--horizontal-kernel-width", type=int, default=70, help="Width used to remove horizontal lines.")

    parser.add_argument("--dilate-width", type=int, default=5, help="Dilation kernel width.")
    parser.add_argument("--dilate-height", type=int, default=9, help="Dilation kernel height.")
    parser.add_argument("--dilate-iterations", type=int, default=2, help="Dilation iterations.")

    parser.add_argument("--min-width", type=int, default=14)
    parser.add_argument("--min-height", type=int, default=30)
    parser.add_argument("--max-width", type=int, default=130)
    parser.add_argument("--max-height", type=int, default=170)
    parser.add_argument("--min-area", type=int, default=250)
    parser.add_argument("--max-aspect-ratio", type=float, default=3.0)

    parser.add_argument("--row-tolerance", type=int, default=45)

    args = parser.parse_args()

    image_path = args.image
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    bgr, mask = load_visible_mask(image_path, threshold=args.threshold)

    cleaned = remove_long_horizontal_lines(
        mask,
        kernel_width=args.horizontal_kernel_width,
    )

    connected = connect_tooth_outlines(
        cleaned,
        dilate_width=args.dilate_width,
        dilate_height=args.dilate_height,
        dilate_iterations=args.dilate_iterations,
    )

    contours, _ = cv2.findContours(
        connected,
        cv2.RETR_EXTERNAL,
        cv2.CHAIN_APPROX_SIMPLE,
    )

    image_height, image_width = mask.shape[:2]

    boxes = filter_boxes(
        contours,
        image_width=image_width,
        image_height=image_height,
        min_width=args.min_width,
        min_height=args.min_height,
        max_width=args.max_width,
        max_height=args.max_height,
        min_area=args.min_area,
        max_aspect_ratio=args.max_aspect_ratio,
    )

    boxes = assign_ids(boxes, row_tolerance=args.row_tolerance)

    json_path = out_dir / "teeth_boxes.json"
    preview_path = out_dir / "teeth_boxes_preview.png"
    html_path = out_dir / "teeth_buttons.html"

    write_json(boxes, image_width, image_height, str(json_path))
    draw_preview(bgr, boxes, str(preview_path))
    write_html(image_path, boxes, image_width, image_height, str(html_path))

    # Also save intermediate masks so you can debug/tune the detection.
    cv2.imwrite(str(out_dir / "01_original_mask.png"), mask)
    cv2.imwrite(str(out_dir / "02_without_horizontal_lines.png"), cleaned)
    cv2.imwrite(str(out_dir / "03_connected_components.png"), connected)

    print(f"Detected {len(boxes)} candidate teeth.")
    print(f"JSON:    {json_path}")
    print(f"Preview: {preview_path}")
    print(f"HTML:    {html_path}")


if __name__ == "__main__":
    main()