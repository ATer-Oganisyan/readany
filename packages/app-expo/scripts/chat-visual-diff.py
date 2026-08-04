#!/usr/bin/env python3
"""Small dependency-light pixel diff for Narra's Telegram comparison stories."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from PIL import Image, ImageChops


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("reference", type=Path)
    parser.add_argument("implementation", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--threshold", type=int, default=16)
    parser.add_argument(
        "--crop",
        default="0,0,0,0",
        metavar="TOP,RIGHT,BOTTOM,LEFT",
        help="Ignore simulator or Storybook chrome, in pixels.",
    )
    args = parser.parse_args()

    try:
        crop_top, crop_right, crop_bottom, crop_left = (
            int(value) for value in args.crop.split(",")
        )
    except ValueError as error:
        raise SystemExit("--crop must be TOP,RIGHT,BOTTOM,LEFT in pixels") from error

    if min(crop_top, crop_right, crop_bottom, crop_left) < 0:
        raise SystemExit("--crop values must be non-negative")

    reference = Image.open(args.reference).convert("RGB")
    implementation = Image.open(args.implementation).convert("RGB")
    full_width = min(reference.width, implementation.width)
    full_height = min(reference.height, implementation.height)
    width = full_width - crop_left - crop_right
    height = full_height - crop_top - crop_bottom
    if width <= 0 or height <= 0:
        raise SystemExit("--crop removes the entire comparison viewport")
    box = (crop_left, crop_top, crop_left + width, crop_top + height)
    reference = reference.crop(box)
    implementation = implementation.crop(box)
    diff = ImageChops.difference(reference, implementation)

    histogram = diff.histogram()
    channel_samples = width * height * 3
    absolute_sum = sum((index % 256) * count for index, count in enumerate(histogram))
    squared_sum = sum(((index % 256) ** 2) * count for index, count in enumerate(histogram))
    mae = absolute_sum / channel_samples
    rmse = math.sqrt(squared_sum / channel_samples)

    masks = [
        channel.point(lambda value: 255 if value > args.threshold else 0)
        for channel in diff.split()
    ]
    changed_mask = ImageChops.lighter(ImageChops.lighter(masks[0], masks[1]), masks[2])
    changed_pixels = changed_mask.histogram()[255]

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        emphasized = diff.point(lambda value: min(255, value * 4))
        emphasized.save(args.output)

    print(
        json.dumps(
            {
                "viewport_px": [width, height],
                "crop_px": [crop_top, crop_right, crop_bottom, crop_left],
                "mae_0_255": round(mae, 4),
                "rmse_0_255": round(rmse, 4),
                "changed_pixels_over_threshold": changed_pixels,
                "changed_percent": round(changed_pixels * 100 / (width * height), 4),
                "threshold": args.threshold,
                "diff": str(args.output) if args.output else None,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
