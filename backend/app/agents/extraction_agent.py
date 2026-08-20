"""
Extraction Agent for PDF text extraction using Vision LLMs.

Uses direct OpenAI-compatible API calls (NOT CodeAgent) to extract text.
This avoids the code parsing issues that occur with CodeAgent.
"""

import base64
from dataclasses import dataclass

from loguru import logger
from openai import OpenAI


@dataclass
class ExtractionResult:
    """Result of extracting text from a PDF page."""

    page_number: int | None
    markdown: str
    success: bool
    error: str | None = None


class ExtractionAgent:
    """
    Vision LLM agent for extracting text from PDF pages.

    Uses direct OpenAI API calls (compatible with OpenRouter) to process
    PDF page images and extract structured Markdown text.

    Usage:
        agent = ExtractionAgent(
            api_key="your-openrouter-key",
            model_id="qwen/qwen3-vl-235b-a22b-instruct",
        )

        result = agent.extract_page(png_bytes, page_number=1)
        print(result.markdown)
    """

    # Optimized for language learning materials (textbooks, novels, study materials)
    SYSTEM_PROMPT = """Extract ALL text from this image into clean Markdown.

    RULES:
    - Extract every word exactly as shown, preserving the original language
    - Use # for titles, ## for sections, ### for subsections
    - Use - for bullet points, 1. for numbered lists
    - Preserve dialogues, vocabulary lists, and example sentences
    - If the page is blank or contains only images: output "[No text content]"
    - Output ONLY the extracted text - no commentary or explanations"""

    def __init__(
        self,
        api_key: str,
        model_id: str,
        api_base: str = "https://openrouter.ai/api/v1",
    ) -> None:
        """
        Initialize the extraction agent.

        Args:
            api_key: OpenRouter API key
            model_id: Vision-capable model ID
            api_base: API base URL
        """
        self._client = OpenAI(
            api_key=api_key,
            base_url=api_base,
        )
        self._model_id = model_id

        logger.info(f"ExtractionAgent initialized with model: {model_id}")

    def extract_page(
        self,
        image_bytes: bytes,
        page_number: int,
    ) -> ExtractionResult:
        """
        Extract text from a single PDF page image.

        Args:
            image_bytes: Rendered page as PNG bytes
            page_number: Page number (1-indexed)

        Returns:
            ExtractionResult with markdown text or error
        """
        try:
            # Convert to base64 for API
            img_base64 = base64.b64encode(image_bytes).decode("utf-8")

            # Call the vision model - system prompt + image only
            response = self._client.chat.completions.create(
                model=self._model_id,
                messages=[
                    {"role": "system", "content": self.SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/png;base64,{img_base64}",
                                },
                            },
                        ],
                    },
                ],
                max_tokens=4096,
                temperature=0.1,  # Low temp for accurate extraction
            )

            markdown = response.choices[0].message.content.strip()

            # Remove code block wrappers if the model added them
            if markdown.startswith("```markdown"):
                markdown = markdown[11:]
            if markdown.startswith("```"):
                markdown = markdown[3:]
            if markdown.endswith("```"):
                markdown = markdown[:-3]
            markdown = markdown.strip()

            logger.debug(f"Extracted page {page_number}: {len(markdown)} chars")

            return ExtractionResult(
                page_number=page_number,
                markdown=markdown,
                success=True,
            )

        except Exception as e:
            logger.error(f"Extraction failed for page {page_number}: {e}")
            return ExtractionResult(
                page_number=page_number,
                markdown="",
                success=False,
                error=str(e),
            )

    def extract_pages(
        self,
        images: list[tuple[int, bytes]],
    ) -> list[ExtractionResult]:
        """
        Extract text from multiple pages.

        Args:
            images: List of (page_number, image_bytes) tuples

        Returns:
            List of ExtractionResult for each page
        """
        return [
            self.extract_page(image_bytes, page_number)
            for page_number, image_bytes in images
        ]
