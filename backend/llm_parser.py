"""LLM-based parser (Brain - converts markdown to JSON)."""
import asyncio
import json
from pathlib import Path
from typing import Dict, Any, Optional
from loguru import logger
import ollama

from config import TEMPLATES_DIR


class LLMParser:
    """Parse document markdown into structured JSON using Ollama LLM."""
    
    def __init__(self):
        """Initialize the parser."""
        self._template_cache: Dict[str, tuple[str, str]] = {}
    
    def clear_cache(self):
        """Clear the template cache to force reload."""
        self._template_cache.clear()
    
    def _load_template(self, template_id: str) -> tuple[str, str]:
        """Load template schema and prompt for a given template ID."""
        if template_id in self._template_cache:
            return self._template_cache[template_id]
        
        schema_path = TEMPLATES_DIR / f"{template_id}.json"
        prompt_path = TEMPLATES_DIR / f"{template_id}.txt"
        
        # Load schema
        if schema_path.exists():
            schema = schema_path.read_text(encoding="utf-8")
        else:
            logger.warning(f"Template schema not found: {schema_path}")
            schema = '{"data": {}}'
        
        # Load prompt
        if prompt_path.exists():
            prompt = prompt_path.read_text(encoding="utf-8")
        else:
            logger.warning(f"Template prompt not found: {prompt_path}")
            prompt = "Extract the document data into the JSON schema provided."
        
        self._template_cache[template_id] = (schema, prompt)
        return schema, prompt
    
    async def parse_markdown(
        self, 
        markdown: str, 
        model: str = "gpt-oss:latest",
        template: str = "resume",
        num_predict: int = 32768
    ) -> Dict[str, Any]:
        """
        Parse document markdown into structured JSON using selected template.
        This is the "Brain" step - reasoning over clean text.
        """
        logger.info(f"Parsing markdown with LLM: {model}, template: {template}, tokens: {num_predict}")
        
        schema, template_prompt = self._load_template(template)
        
        prompt = f"""{template_prompt}

JSON Schema:
{schema}

Document Text:
{markdown}

Return ONLY the JSON object:"""

        try:
            # Run blocking LLM call in thread pool to not block event loop
            response = await asyncio.to_thread(
                ollama.chat,
                model=model,
                messages=[{'role': 'user', 'content': prompt}],
                options={'temperature': 0.0, 'num_predict': num_predict}
            )
            
            result = response['message']['content'].strip()
            logger.info(f"LLM response length: {len(result)} chars")
            
            # Sanitize: remove/replace problematic characters for UTF-8 compatibility
            result = result.encode('utf-8', errors='replace').decode('utf-8')
            
            # Clean markdown code blocks if present
            if result.startswith('```'):
                parts = result.split('```')
                if len(parts) >= 2:
                    result = parts[1]
                    if result.startswith('json'):
                        result = result[4:]
                result = result.strip()
            
            # Find JSON start
            json_start = -1
            for i, char in enumerate(result):
                if char == '{':
                    json_start = i
                    break
            
            if json_start > 0:
                result = result[json_start:]
            
            # Parse JSON
            parsed = json.loads(result)
            logger.info(f"Successfully parsed JSON with keys: {list(parsed.keys())}")
            return parsed
            
        except json.JSONDecodeError as e:
            logger.error(f"JSON parse error: {e}")
            logger.error(f"Raw result: {result[:500]}...")
            return self._empty_result(template)
        except Exception as e:
            logger.error(f"LLM parsing failed: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return self._empty_result(template)
    
    def _empty_result(self, template: str) -> Dict[str, Any]:
        """Return empty result matching template schema."""
        schema, _ = self._load_template(template)
        try:
            return json.loads(schema)
        except:
            return {}


# Global instance
llm_parser: Optional[LLMParser] = None


def get_llm_parser() -> LLMParser:
    """Get the global LLM parser instance."""
    global llm_parser
    if llm_parser is None:
        llm_parser = LLMParser()
    return llm_parser
