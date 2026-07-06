/**
 * Vercel Serverless Function Config
 * Raises the request body parser limit to support large PDF extractions
 */
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  }
};

/**
 * Vercel Serverless Function
 * Endpoint: /api/analyze
 * Purpose: Securely analyzes study materials using the official Groq API with robust schema mapping.
 */
export default async function handler(req, res) {
  // 1. Enforce POST Request Method Only
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
    console.error('[BEACON BACKEND ERROR] Missing GROQ_API_KEY environment variable.');
    return res.status(500).json({
      success: false,
      error: 'Backend Configuration Error: Groq API Key is not set in Vercel environment variables.'
    });
  }

  try {
    // 3. Robust Request Body & JSON Validation (Handles buffers, stringified JSON, and native objects)
    let body;
    if (typeof req.body === 'string') {
      try {
        body = JSON.parse(req.body);
      } catch (jsonParseError) {
        return res.status(400).json({
          success: false,
          error: 'Bad Request: Invalid JSON formatting in request body.'
        });
      }
    } else if (req.body && Buffer.isBuffer(req.body)) {
      try {
        body = JSON.parse(req.body.toString('utf-8'));
      } catch (bufferParseError) {
        return res.status(400).json({
          success: false,
          error: 'Bad Request: Invalid JSON formatting in request Buffer.'
        });
      }
    } else {
      body = req.body;
    }

    if (!body || Object.keys(body).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request: Missing request body contents.'
      });
    }

    const { text } = body;

    // 4. Detailed Text String Validators
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
    if (trimmedText === '') {
      return res.status(400).json({
        success: false,
        error: 'Bad Request: "text" field cannot be empty.'
      });
    }

    if (trimmedText.length < 50) {
      return res.status(400).json({
        success: false,
        error: 'Bad Request: Content is too short to analyze. Provide at least 50 characters of study material.'
      });
    }

    // 5. Large Document Safety Safeguard
    // Truncating excessively large PDFs to protect function from exceeding context limits or causing Vercel timeouts.
    // 40,000 characters provides ~8,000 to 10,000 words, perfect for deep analysis while ensuring fast response times.
    const MAX_TEXT_LENGTH = 40000;
    let analyzedText = trimmedText;
    let wasTruncated = false;

    if (trimmedText.length > MAX_TEXT_LENGTH) {
      analyzedText = trimmedText.substring(0, MAX_TEXT_LENGTH) + "\n\n[System Notice: The remaining document text was safely truncated here by Beacon's backend to respect payload limitations.]";
      wasTruncated = true;
    }

    // 6. Beacon AI Identity Prompt & JSON Schema Engineering
    const systemPrompt = `You are Beacon, an exceptionally intelligent mentor, tutor, study strategist, and guiding companion.
Your guiding philosophy is: "Beacon: Guiding You Through Every Lesson."
Your mission is NOT simply to summarize documents. Your mission is to ensure the student deeply understands every concept.
Always optimize for conceptual understanding, clarity, depth, academic accuracy, logical progression, and real learning.
Never produce shallow summaries or simply list facts. Instead, explain WHY concepts matter, HOW they connect, and WHEN they are applied.

Your writing style should feel like an exceptional university professor combined with a world-class private tutor.
Every explanation must be detailed, accurate, engaging, logically organized, beginner friendly, and academically rigorous.
Avoid robotic language, repetitive phrases, and generic textbook wording.
Whenever appropriate:
• provide intuition and analogies
• explain cause and effect
• relate concepts together
• explain common misconceptions
• explain why students usually struggle with these topics
• provide memory tricks (mnemonics, associations)

You must output valid JSON ONLY.
Never output any markdown blocks like \`\`\`json. Return only raw, parsing-ready stringified JSON.
No conversational intro or outro text. Keep explanations dense and eliminate redundant filler phrases to optimize token generation speed.

Strictly adhere to this detailed academic JSON schema:
{
  "title": "A highly descriptive, educational title matching the subject matter of the text",
  "summary": "An introduction explaining: what the document is about, why it matters, the major ideas, how the ideas connect, and what students should focus on first. Must feel like a teacher introducing a chapter.",
  "topics": [
    {
      "title": "Topic Name",
      "importance": "Detailed explanation of why this topic is essential to understand",
      "difficulty": "Beginner, Intermediate, or Advanced",
      "estimated_learning_time": "Estimated study time (e.g. 30 minutes)",
      "prerequisites": "What the student needs to understand first before learning this topic",
      "common_misconceptions": "A misconception students usually have and why it is incorrect",
      "real_world_applications": "How this concept is actively applied in industries or daily life"
    }
  ],
  "subtopics": [
    {
      "title": "Subtopic Name",
      "learning_order": 1,
      "description": "An engaging, deep pedagogical description explaining the subtopic thoroughly"
    }
  ],
  "important_points": [
    {
      "point": "Core conceptual takeaway/idea",
      "why_it_matters": "A deep academic explanation of why this point holds high significance"
    }
  ],
  "keywords": ["Critical academic terms or jargon"],
  "definitions": [
    {
      "term": "Term Name",
      "meaning": "Detailed semantic explanation",
      "importance": "Why understanding this specific term is relevant to the field",
      "example": "A concrete, relatable example demonstrating the term",
      "real_world_context": "How this term applies practically outside the classroom"
    }
  ],
  "formulas": [
    {
      "formula": "The math/logic/scientific formula written in standard LaTeX formatting (e.g., $$E = mc^2$$)",
      "variable_explanations": "Breakdown of every single variable/constant in the formula",
      "meaning": "Conceptual explanation of what this mathematical relationship represents",
      "derivation": "A brief pedagogical breakdown of where this relationship originates, if applicable",
      "when_to_use": "Scenarios or problem-types where this formula is the correct tool",
      "common_mistakes": "Typical algebraic or logical slip-ups students make when solving with this formula",
      "example_calculation": "A step-by-step mathematical example using sample numbers to show how to arrive at an answer"
    }
  ],
  "flashcards": [
    {
      "front": "An active recall question designed to provoke critical, deep thought rather than simple memory retrieval",
      "back": "A concise, complete, logically rich explanation representing the model memory target"
    }
  ],
  "quiz_questions": [
    {
      "question": "A rigorous, university-level multiple-choice question testing conceptual mechanics",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct_answer": "The exact string match of the correct option",
      "explanation": "Extremely detailed breakdown explaining why the correct option is true, and why each of the other three incorrect options are false or misleading"
    }
  ],
  "exam_questions": [
    {
      "question": "An open-ended, analytical, or application-focused university-level essay question",
      "model_answer": "A perfect, model-grade framework outline showcasing key arguments, concepts, and structures the student must include to score full credit"
    }
  ],
  "difficulty": "Overall composite difficulty of the text (Beginner, Intermediate, or Advanced)",
  "estimated_study_time": "Estimated reading and comprehension time for the entire material"
}`;

    // 7. Establish Fetch Call with Timeout Abort Controller
    // Vercel Hobby accounts forcefully terminate functions after 10s.
    // By setting our internal cutoff at 8.5 seconds (8500ms), we can catch the timeout internally,
    // and return a graceful, user-friendly JSON response instead of a native Vercel HTML Crash page.
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, 8500);

    let groqResponse;
    try {
      // Official OpenAI-compatible endpoint for Groq
      groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile', // Premier document analysis reasoning model
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Analyze this material with complete academic depth:\n\n${analyzedText}` }
          ],
          temperature: 0.3, // Keeps output highly structured and deterministic
          response_format: { type: 'json_object' }, // Guarantees JSON mode compliance
          max_tokens: 4500 // Balanced output threshold preventing response truncation
        }),
        signal: abortController.signal
      });
    } catch (fetchError) {
      if (fetchError.name === 'AbortError') {
        return res.status(504).json({
          success: false,
          error: 'Timeout Exception: The academic material is highly complex and took too long to analyze. Please try a smaller section of text or retry in a few moments.'
        });
      }
      throw fetchError;
    } finally {
      clearTimeout(timeoutId);
    }

    // 8. Handle Groq Error Responses
    if (!groqResponse.ok) {
      const errorPayload = await groqResponse.json().catch(() => ({}));
      const errorText = JSON.stringify(errorPayload) || `HTTP Error ${groqResponse.status}`;
      console.error(`[GROQ API ERROR] Status Code: ${groqResponse.status}`, errorText);

      // Returns the error package safely for structural debugging in active development.
      return res.status(502).json({
        success: false,
        error: 'Upstream AI Service Error: Groq API rejected the analysis request.',
        details: errorPayload
      });
    }

    const responseData = await groqResponse.json();
    const rawAiResponse = responseData.choices?.[0]?.message?.content;

    if (!rawAiResponse) {
      console.error('[BEACON BACKEND ERROR] Empty text choices received from Groq:', responseData);
      return res.status(502).json({
        success: false,
        error: 'Invalid AI Payload: Groq returned a response without valid content generation.'
      });
    }

    // 9. Safe Schema Formatting and Parsing
    let parsedAnalysis;
    try {
      // Strip accidental Markdown framing block formatting if any bypass occurs
      const cleanJsonString = rawAiResponse
        .replace(/^```json/i, '')
        .replace(/```$/, '')
        .trim();

      parsedAnalysis = JSON.parse(cleanJsonString);
    } catch (parseError) {
      console.error('[BEACON BACKEND ERROR] Failed to parse generated content to JSON. Raw text:', rawAiResponse);
      return res.status(500).json({
        success: false,
        error: 'AI formatting error: Failed to parse the study guide structure into proper JSON format.',
        rawResponse: rawAiResponse
      });
    }

    // 10. Inject Truncation Metadata Warning for Front-end Context Display
    if (wasTruncated && parsedAnalysis) {
      parsedAnalysis.truncated_warning = "The original uploaded document was extremely large and was safely shortened by Beacon to focus study highlights on the first major chapters of the text.";
    }

    // 11. Return Success Result
    return res.status(200).json({
      success: true,
      analysis: parsedAnalysis
    });

  } catch (error) {
    console.error('[CRITICAL BEACON BACKEND FAILURE]', error);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error: An unexpected exception occurred inside the serverless function.'
    });
  }
}
