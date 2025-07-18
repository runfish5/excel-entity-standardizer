// services/normalizer.router.js

import { findBestMatch } from './normalizer.fuzzy.js';

export class NormalizerRouter {
    constructor(forward, reverse, config) {
        this.forward = forward;
        this.reverse = reverse;
        this.config = config;
    }

    async process(value) {
        const val = String(value || '').trim();
        if (!val) return null;

        // return this.findCached(val) || await this.findTokenMatch(val) || this.findFuzzy(val) || await this.callLLM(val);
        return this.findCached(val) || await this.findTokenMatch(val) || this.findFuzzy(val);
    }

    findCached(val) {
        if (val in this.forward) {
            const mapping = this.forward[val];
            return { target: typeof mapping === 'string' ? mapping : mapping.target, method: 'cached', confidence: 1.0 };
        }
        if (val in this.reverse) {
            return { target: val, method: 'cached', confidence: 1.0 };
        }
        return null;
    }

    findFuzzy(val) {
        const fwd = findBestMatch(val, this.forward, 0.7);
        if (fwd) {
            const mapping = fwd.value;
            return { target: typeof mapping === 'string' ? mapping : mapping.target, method: 'fuzzy', confidence: fwd.score };
        }

        const rev = findBestMatch(val, this.reverse, 0.5);
        if (rev) {
            return { target: rev.key, method: 'fuzzy', confidence: rev.score };
        }
        return null;
    }

    async findTokenMatch(val) {
        // The normalizer.router.js code, I can see the issue. 
        // The findTokenMatch function expects 
        // data.matches to be an array of tuples like [candidate_name, score],
        console.log(`🔍 findTokenMatch called for: ${val}`);
        console.trace('Called from:');
    
        try {
            const res = await fetch("http://127.0.0.1:8000/research-and-match", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: val })
            });

            if (!res.ok) return null;
            
            const data = await res.json();
            if (data.error || !data.matches?.length) return null;

            // Log the API output
            console.log('API Response Data:', JSON.stringify(data, null, 2));
            console.log('Raw matches:', data.matches);
            console.log('Full results:', data.full_results);

            // Filter matches above minimum confidence threshold
            const qualifyingMatches = data.matches.filter(match => match[1] >= 0.005);
            
            console.log('Qualifying matches (>= 0.005):', qualifyingMatches);
            
            if (qualifyingMatches.length === 0) return null;

            // Return all candidates instead of selecting the best one
            return { 
                type: 'multiple_matches',
                matches: qualifyingMatches,
                fullResults: data.full_results,
                method: 'ProfileRank'
            };
            
        } catch (error) {
            console.error('Token match error:', error);
            return null;
        }
    }
    selectBestMatch(matches, fullResults) {
        // If only one match, return it
        if (matches.length === 1) {
            return matches[0];
        }
        
        // Multiple matches - apply selection logic
        const [topMatch, secondMatch] = matches;
        
        // If top match has significantly higher score (>20% difference), use it
        const scoreDifference = topMatch[1] - secondMatch[1];
        if (scoreDifference > 0.2) {
            return topMatch;
        }
        
        // If scores are close, prefer matches with better spec_match_score
        if (fullResults?.ranked_candidates) {
            const topCandidate = fullResults.ranked_candidates.find(c => c.candidate === topMatch[0]);
            const secondCandidate = fullResults.ranked_candidates.find(c => c.candidate === secondMatch[0]);
            
            if (topCandidate && secondCandidate) {
                // Prefer higher spec_match_score
                if (topCandidate.spec_match_score > secondCandidate.spec_match_score) {
                    return topMatch;
                }
                if (secondCandidate.spec_match_score > topCandidate.spec_match_score) {
                    return secondMatch;
                }
                
                // Prefer fewer spec_gaps
                if (topCandidate.spec_gaps.length < secondCandidate.spec_gaps.length) {
                    return topMatch;
                }
                if (secondCandidate.spec_gaps.length < topCandidate.spec_gaps.length) {
                    return secondMatch;
                }
            }
        }
        
        // Default to highest relevance score (first match)
        return topMatch;
    }


    async callLLM(val) {
        const body = { source_value: val, project_name: "dummy-project", mapping_name: "dummy-mapping" };
        const prompt = this.config?.standardization_prompt;
        if (Array.isArray(prompt) && prompt.length) body.standardization_prompt = prompt.at(-1);

        const res = await fetch("http://127.0.0.1:8000/llm-generate-normalized-term", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });

        if (!res.ok) throw new Error(`LLM API error: ${res.status}`);
        
        const data = await res.json();
        if (!data.mappedValue) throw new Error("No value returned from LLM");

        // Store new mapping in the forward object
        this.forward[val] = {
            target: data.mappedValue,
            method: 'llm',
            confidence: data.confidence || 0.8,
            timestamp: new Date().toISOString()
        };

        return { target: data.mappedValue, method: 'llm', confidence: data.confidence || 0.8 };
    }
}