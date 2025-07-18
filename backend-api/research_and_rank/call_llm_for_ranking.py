#@title call_llm_for_ranking()
from groq import Groq
import json

# Import the correction function, assuming it's in a sibling module
from .correct_candidate_strings import correct_candidate_strings

def call_llm_for_ranking(profile_info, match_results, query, groq_api_key):
    """
    Ranks candidates using an LLM, corrects the output strings,
    and formats the final successful API response.
    """
    ranking_schema = {
        # ... (your existing schema definition remains unchanged)
        "type": "object",
        "properties": {
            "profile_specs_identified": {
                "type": "object",
                "properties": {
                    "material_type": {"type": "string"},
                    "glass_fiber_percentage": {"type": "string"},
                    "other_critical_specs": {"type": "array", "items": {"type": "string"}}
                },
                "required": ["material_type", "glass_fiber_percentage"]
            },
            "ranked_candidates": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "rank": {"type": "integer"},
                        "candidate": {"type": "string"},
                        "relevance_score": {"type": "number"},
                        "spec_match_score": {"type": "number"},
                        "key_match_factors": {"type": "array", "items": {"type": "string"}},
                        "spec_gaps": {"type": "array", "items": {"type": "string"}}
                    },
                    "required": ["rank", "candidate", "relevance_score", "spec_match_score", "key_match_factors"]
                }
            },
            "ranking_explanation": {
                "type": "object",
                "properties": {
                    "methodology": {"type": "string"},
                    "key_differentiators": {"type": "array", "items": {"type": "string"}},
                    "confidence_level": {"type": "string"}
                },
                "required": ["methodology", "key_differentiators", "confidence_level"]
            }
        },
        "required": ["profile_specs_identified", "ranked_candidates", "ranking_explanation"]
    }
    
    match_list = "\n".join([f"{i+1}. {term} (Score: {score:.3f})" 
                            for i, (term, score) in enumerate(match_results[:20])])
    
    prompt = f"""STEP 1: IDENTIFY EXACT SPECIFICATIONS FROM PROFILE
First, extract the exact technical specifications from the research profile below.

QUERY: {query}

RESEARCH PROFILE:
{profile_info}

CANDIDATE MATCHES:
{match_list}

CRITICAL INSTRUCTIONS:
1. FIRST: Identify the exact Glass Fiber percentage specified in the profile (look for "Glass Fiber', 'specification': 'X%'")
2. SECOND: Identify the exact material type (PA66, PA6, etc.)
3. THIRD: Rank candidates based on EXACT specification matches

RANKING PRIORITY:
- Exact Glass Fiber % match = highest priority
- Exact material type match = second priority  
- Close matches = lower priority
- Mismatched specs = lowest priority

If profile shows 35% Glass Fiber, then "35% GF" candidates must rank higher than "25% GF" or "50% GF" candidates.

Provide the identified specs first, then ranking based on exact specification matching."""

    client = Groq(api_key=groq_api_key)
    
    chat_completion = client.chat.completions.create(
        model="meta-llama/llama-4-maverick-17b-128e-instruct",
        messages=[{"role": "user", "content": prompt}],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "spec_based_ranking",
                "schema": ranking_schema
            }
        },
        temperature=0
    )
    
    ranking_result = json.loads(chat_completion.choices[0].message.content)
    
    # --- PIPELINE STEP 4: Correct Candidate Strings ---
    print("\n[PIPELINE] Step 4: Correcting candidate strings")
    final_results = correct_candidate_strings(ranking_result, match_results)
    
    # --- Formatting a successful response ---
    if isinstance(final_results, dict) and 'ranked_candidates' in final_results:
        ranked_candidates = final_results['ranked_candidates']
        print(f"\n[PIPELINE] Success! Found {len(ranked_candidates)} matches.")
        
        formatted_matches = [
            [c.get('candidate', 'Unknown'), c.get('relevance_score', 0.0)]
            for c in ranked_candidates
        ]
        
        # Log top 3 matches for clarity
        for i, candidate in enumerate(formatted_matches[:3]):
            print(f"  {i+1}. '{candidate[0]}' (score: {candidate[1]:.3f})")

        return {
            "query": query,
            "matches": formatted_matches,
            "total_matches": len(formatted_matches),
            "research_performed": True,
            "full_results": final_results
        }
    else:
        # Fallback for unexpected format from the pipeline
        print(f"[WARNING] Unexpected results format: {type(final_results)}")
        return {
            "query": query,
            "matches": [],
            "total_matches": 0,
            "research_performed": True
        }