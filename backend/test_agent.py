#!/usr/bin/env python3
"""
Quick test script for the Extraction Agent.

Tests the agent with a simple text image to verify it's working.

Usage:
    cd backend
    uv run python test_agent.py
"""

import io
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent))

from PIL import Image, ImageDraw

from app.agents import ExtractionAgent
from app.core import get_settings
from app.core.app_config import get_app_config


def create_test_image():
    """Create a simple test image with text."""
    # Create white image
    img = Image.new("RGB", (800, 600), color="white")
    draw = ImageDraw.Draw(img)

    # Add test text
    text = """
    Test Document

    This is a simple test page.

    • Bullet point 1
    • Bullet point 2

    ## Heading 2

    Some paragraph text here.
    """

    # Draw text (using default font)
    y_offset = 50
    for line in text.strip().split("\n"):
        draw.text((50, y_offset), line.strip(), fill="black")
        y_offset += 30

    # Convert to PNG bytes
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()


def main():
    """Test the extraction agent."""
    print("🧪 Testing Extraction Agent...\n")

    settings = get_settings()
    extraction_config = get_app_config().extraction

    # Check environment
    if not settings.openrouter_api_key:
        print("❌ ERROR: OPENROUTER_API_KEY not set in environment")
        print("   Please set it in backend/.env")
        return 1

    print(f"✓ API Key: {settings.openrouter_api_key[:10]}...")
    print(f"✓ Model: {extraction_config.agent_model}")
    print()

    # Create test image
    print("📄 Creating test image...")
    image_bytes = create_test_image()
    print(f"✓ Image created ({len(image_bytes)} bytes)")
    print()

    # Initialize agent
    print("🤖 Initializing agent...")
    try:
        agent = ExtractionAgent(
            api_key=settings.openrouter_api_key,
            model_id=extraction_config.agent_model,
            api_base="https://openrouter.ai/api/v1",
        )
        print("✓ Agent initialized")
    except Exception as e:
        print(f"❌ Failed to initialize agent: {e}")
        return 1

    print()

    # Extract text
    print("🔍 Extracting text from image...")
    try:
        result = agent.extract_page(image_bytes, page_number=1)

        if result.success:
            print("✅ EXTRACTION SUCCESSFUL!\n")
            print("=" * 60)
            print("Extracted Markdown:")
            print("=" * 60)
            print(result.markdown)
            print("=" * 60)
            print(f"\n✓ Extracted {len(result.markdown)} characters")
            return 0
        else:
            print(f"❌ EXTRACTION FAILED: {result.error}")
            return 1

    except Exception as e:
        print(f"❌ Exception during extraction: {e}")
        import traceback

        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
