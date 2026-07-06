/**
 * Vercel Serverless Function
 * Endpoint: /api/analyze
 * Purpose: Analyzes study material text securely via Groq API and returns structured study resources.
 */

export default async function handler(req, res) {
  // 1. Enforce POST Request Method
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({
      success: false,
      error: `Method ${req.method} Not Allowed. Only POST is accepted.`
    });
  }

  // 2. Validate API Key Presence
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error('Server Configuration Error: Missing GROQ_API_KEY environment variable.');
    return res.status(500).json({
      success: false,
      error: 'Backend is misconfigured. Missing API key.'
    });
  }

  try {
    // 3. Request Body Validation
    const body = req.body;
    if (!body) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request: Missing request body.'
      });
    }

    const { text } = body;
    if (text === undefined || text === null) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request: Missing "text" field in the JSON payload.'
      });
    }

    if (typeof text !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Bad Request: "text" field must be a valid string.'
      });
    }

    const trimmedText = text.trim();
    if (trimmedText.length < 50) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request: Text content is too short to analyze. Provide at least 50 characters.'
      });
    }

    // 4. Constructing System Prompt & Schema Guidelines for Groq
    const systemPrompt = `You are Beacon, an exceptionally intelligent, hyper-focused AI study assistant.
Your sole job is to analyze study materials and return highly effective, deeply structured study aids.

You must output valid JSON ONLY.
Never output any narrative text, conversational preambles, or postscripts.
Never wrap your JSON response in markdown blocks like \`\`\`json. Return only raw stringified JSON.

You must extract and generate study resources using exactly the following JSON structure:
{
  "title": "A concise, academic title matching the subject matter of the text",
  "summary": "A comprehensive, high-quality, 3-4 sentence overview of the document",
  "topics": ["Key high-level primary topics"],
  "subtopics": ["Secondary subtopics or subcomponents explored in the text"],
  "important_points": ["Key takeaways, deep insights, or core structural pillars discussed in the text"],
  "keywords": ["Core specialized terms and academic jargon"],
  "definitions": [
    {
      "term": "Term Name",
      "definition": "Clear, contextual definition of the term based on the study material"
    }
  ],
  "formulas": [
    {
      "name": "Formula/Theorem Name (if applicable, otherwise omit this array or leave empty)",
      "formula": "The math, chemistry, or logic formula (using LaTeX formatting standard, e.g. E = mc^2)",
      "description": "What this formula measures or calculates"
    }
  ],
  "flashcards": [
    {
      "front": "An effective, high-yield study question or prompt",
      "back": "A concise, memorable, and informative answer"
    }
  ],
  "quiz_questions": [
    {
      "question": "A clear multiple-choice question testing understanding",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct_answer": "The exact matching string of the correct option",
      "explanation": "Why this option is correct and why the others are incorrect"
    }
  ],
  "exam_questions": [
    {
      "question": "A challenging, analytical, or open-ended exam-style essay/conceptual question",
      "suggested_answer": "A model blueprint outline/answer indicating what a student should include"
    }
  ],
  "difficulty": "Beginner, Intermediate, or Advanced",
  "estimated_study_time": "Estimated reading and comprehension time based on complexity (e.g., '25 minutes', '2 hours')"
}

Ensure all information is accurate, fact-based, and directly pulled or logically synthesized from the input study material.`;

    // 5. Query the Groq Chat Completions API
    // Using llama-3.3-70b-versatile for top-tier reasoning and structural accuracy
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Analyze the following study material:\n\n${trimmedText}` }
        ],
        temperature: 0.2, // Low temperature for deterministic, structural consistency
        response_format: { type: 'json_object' } // Enforces JSON output from Groq
      })
    });

    if (!groqResponse.ok) {
      const errorText = await groqResponse.text();
      console.error(`Groq API returned an error status (${groqResponse.status}):`, errorText);
      return res.status(502).json({
        success: false,
        error: 'Failed to communicate with the upstream AI provider.'
      });
    }

    const data = await groqResponse.json();
    const rawAiResponse = data.choices?.[0]?.message?.content;

    if (!rawAiResponse) {
      console.error('Empty response content received from Groq:', data);
      return res.status(502).json({
        success: false,
        error: 'AI provider returned an empty or invalid content payload.'
      });
    }

    // 6. Safe Parsing of the AI Response
    let parsedAnalysis;
    try {
      // Clean up accidental Markdown packaging if present
      const cleanedJsonText = rawAiResponse
        .replace(/^```json/i, '')
        .replace(/```$/, '')
        .trim();

      parsedAnalysis = JSON.parse(cleanedJsonText);
    } catch (parseErr) {
      console.error('Failed to parse raw output from AI into JSON. Raw text was:', rawAiResponse);
      return res.status(500).json({
        success: false,
        error: 'Failed to properly format and parse the AI analysis schema.',
        rawResponse: rawAiResponse // Safe fallback to raw string content for debugging
      });
    }

    // 7. Return Successful Analysis
    return res.status(200).json({
      success: true,
      analysis: parsedAnalysis
    });

  } catch (globalError) {
    console.error('Unhandled internal function error:', globalError);
    return res.status(500).json({
      success: false,
      error: 'An internal server error occurred while analyzing the document.'
    });
  }
}
