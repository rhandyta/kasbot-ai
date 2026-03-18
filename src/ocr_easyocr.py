#!/usr/bin/env python3
"""
EasyOCR wrapper for WA-Finance.
Takes an image file path as command-line argument, runs EasyOCR,
and prints the recognized text (joined by newlines).
"""

import sys
import os
import json

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No image path provided"}), file=sys.stderr)
        sys.exit(1)
    
    image_path = sys.argv[1]
    if not os.path.isfile(image_path):
        print(json.dumps({"error": f"File not found: {image_path}"}), file=sys.stderr)
        sys.exit(1)
    
    try:
        import easyocr
    except ImportError as e:
        print(json.dumps({"error": "EasyOCR not installed"}), file=sys.stderr)
        sys.exit(1)
    
    reader = easyocr.Reader(['en', 'id'], gpu=False, verbose=False)

    allowlist = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,:/-()"

    def readtext_safe(**kwargs):
        try:
            return reader.readtext(**kwargs)
        except TypeError:
            minimal = {
                "image": kwargs.get("image"),
                "detail": kwargs.get("detail", 0),
                "paragraph": kwargs.get("paragraph", False),
            }
            return reader.readtext(**minimal)

    result = readtext_safe(
        image=image_path,
        detail=0,
        paragraph=False,
        decoder="greedy",
        allowlist=allowlist,
        text_threshold=0.6,
        low_text=0.3,
        link_threshold=0.4,
        mag_ratio=1.5,
    )

    if not result:
        result = readtext_safe(
            image=image_path,
            detail=0,
            paragraph=True,
            rotation_info=[0, 90, 180, 270],
            decoder="beamsearch",
            allowlist=allowlist,
            text_threshold=0.55,
            low_text=0.25,
            link_threshold=0.4,
            mag_ratio=1.7,
            contrast_ths=0.1,
            adjust_contrast=0.7,
        )
    
    # Combine lines with newline
    text = "\n".join(result)
    
    # Output as JSON to ensure proper encoding
    print(json.dumps({"text": text}))
    
if __name__ == "__main__":
    main()
