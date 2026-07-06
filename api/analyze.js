/**
 * Vercel Serverless Function Config
 * Raises the request body parser limit to support extremely large PDF extractions
 */
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb'
    }
  }
};

/**
 * Vercel Serverless Function
 * Endpoint: /api/analyze
 * Purpose: Securely analyzes study materials using the official Groq API, 
 * scaling study asset density and depth proportionally to document length.
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

    // 5. Dynamic Sizing & Proportional Density Calculation
    // We calculate the length metrics of the text and dynamically instruct the LLM
    // on how many quiz questions, flashcards, and topics to generate.
    const inputLength = trimmedText.length;
    let targetQuizCount = 4;
    let targetFlashcardCount = 5;
    let targetTopicsCount = 3;
    let summaryDetailGuideline = "a warm, engaging introductory overview of 1-2 friendly paragraphs introducing core foundational concepts.";

    if (inputLength < 6000) {
      // Small PDF / Article
      targetQuizCount = 4;
      targetFlashcardCount = 6;
      targetTopicsCount = 3;
      summaryDetailGuideline = "a warm, encouraging, conversational introductory summary of 1-2 paragraphs introducing foundational ideas.";
    } else if (inputLength < 25000) {
      // Medium PDF / Chapter
      targetQuizCount = 8;
      targetFlashcardCount = 12;
      targetTopicsCount = 5;
      summaryDetailGuideline = "a deeply engaging, comprehensive 3-paragraph summary introducing macro connections, chapter priorities, and key study recommendations.";
    } else if (inputLength < 60000) {
      // Large PDF / Masterclass
      targetQuizCount = 12;
      targetFlashcardCount = 18;
      targetTopicsCount = 8;
      summaryDetailGuideline = "an extensive academic introductory masterclass (4-5 paragraphs) weaving together interdisciplinary implications, roadmap overviews, and concept-map connections.";
    } else {
      // Extremely Large PDF / Textbook Section
      targetQuizCount = 18;
      targetFlashcardCount = 25;
      targetTopicsCount = 12;
      summaryDetailGuideline = "a monumental, multi-section chapter breakdown (5-7 paragraphs) outlining complete learning trajectories, systematic structural connections, and a full thematic synthesis.";
    }

    // 6. Context Windows & Truncation Safety Boundaries
    // We set a high processing ceiling of 90,000 characters (~18,000 - 22,000 words).
    // This allows us to process extremely large PDFs without causing LLM context crashes or timing out.
    const MAX_TEXT_LENGTH = 90000;
    let analyzedText = trimmedText;
    let wasTruncated = false;

    if (trimmedText.length > MAX_TEXT_LENGTH) {
      analyzedText = trimmedText.substring(0, MAX_TEXT_LENGTH) + "\n\n[System Notice: The remaining document text was safely truncated here by Beacon's backend to respect upstream context bounds.]";
      wasTruncated = true;
    }

    // 7. Beacon Conversational AI Identity Prompt & JSON Schema Engineering
    const systemPrompt = `You are Beacon, an exceptionally intelligent, supportive, and friendly study strategist, expert mentor, and learning companion.
Your guiding philosophy is: "Beacon: Guiding You Through Every Lesson."
Your mission is to ensure the student feels supported and deeply understands every concept instead of just memorizing facts.

Your tone should feel like an incredibly encouraging, supportive university professor combined with a friendly, world-class private tutor.
Avoid cold textbook phrasing or robotic wording. Speak directly to the student in the first-person when appropriate. Use warm hooks, intuitive analogies, real-world context, and clear explanations of why concepts hold value.

Your instructions are strictly customized to the length of the uploaded document:
- You must generate EXACTLY ${targetQuizCount} high-quality, conceptual multiple-choice quiz questions.
- You must generate EXACTLY ${targetFlashcardCount} robust active-recall flashcards.
- You must extract at least ${targetTopicsCount} distinct structural topics.
- Your summary must adhere to: ${summaryDetailGuideline}

You must output valid JSON ONLY. 
Do NOT wrap the JSON in markdown formatting blocks like \`\`\`json. Return only raw, parsing-ready stringified JSON.
Do not provide any conversational intro or outro outside the JSON structure.

Strictly adhere to this detailed academic JSON schema:
{
  "title": "An inviting, educational title reflecting the subject matter",
  "mentor_welcome": "A warm, personal, highly encouraging conversational welcome greeting the user directly (e.g. 'Hey there, future expert! Beacon here. Let's conquer this together...'). Set a friendly, supportive tone.",
  "summary": "The structured introduction as directed by your length guidelines.",
  "topics": [
    {
      "title": "Topic Name",
      "importance": "Detailed friendly explanation of why this topic is highly essential to master",
      "difficulty": "Beginner, Intermediate, or Advanced",
      "estimated_learning_time": "Estimated study time (e.g., '20 minutes')",
      "prerequisites": "Pre-requisite understanding needed for this specific topic",
      "common_misconceptions": "A common trap or misconception students fall into, and the intuitive reason why it is wrong",
      "real_world_applications": "How this concept operates in real-world environments or industry"
    }
  ],
  "subtopics": [
    {
      "title": "Subtopic Name",
      "learning_order": 1,
      "description": "An engaging, deep pedagogical description explaining the subtopic concepts thoroughly"
    }
  ],
  "important_points": [
    {
      "point": "High-value conceptual takeaway",
      "why_it_matters": "A deep explanatory breakdown of why this point holds high significance"
    }
  ],
  "keywords": ["Critical terminology or jargon definitions"],
  "definitions": [
    {
      "term": "Term Name",
      "meaning": "Clear, detailed semantic explanation",
      "importance": "Why understanding this specific term is relevant to the field",
      "example": "A concrete, relatable example demonstrating the term",
      "real_world_context": "How this term applies practically outside the classroom"
    }
  ],
  "formulas": [
    {
      "formula": "The math/logic/scientific formula written in standard LaTeX formatting (e.g., $$E = mc^2$$). Leave array empty if no formulas are relevant.",
      "variable_explanations": "Breakdown of every single variable or constant in the formula",
      "meaning": "Conceptual explanation of what this relationship represents",
      "derivation": "A brief pedagogical breakdown of where this relationship originates, if applicable",
      "when_to_use": "Scenarios or problem-types where this formula is the correct tool",
      "common_mistakes": "Typical algebraic or logical slip-ups students make when solving with this formula",
      "example_calculation": "A step-by-step mathematical example using sample numbers to show how to arrive at an answer"
    }
  ],
  "flashcards": [
    {
      "front": "An active recall question designed to provoke deep thought rather than simple memory retrieval",
      "back": "A concise, complete, logically rich explanation representing the model memory target"
    }
  ],
  "quiz_questions": [
    {
      "question": "A rigorous, conceptual multiple-choice question testing structural mechanics",
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
  "estimated_study_time": "Estimated reading and comprehension time for the entire material",
  "study_strategy_tip": "A highly customized, friendly study trick, memory anchor, or motivational tip from Beacon to the student on how to digest this specific material"
}`;

    // 8. Establish Fetch Call with Timeout Abort Controller
    // Vercel Hobby accounts have a hard 10s timeout limit. 
    // We target 8.5 seconds (8500ms) to allow the API to gracefully catch the timeout and return an actionable JSON message,
    // rather than letting the Vercel thread crash on the frontend with a generic 504.
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, 8500);

    let groqResponse;
    try {
      groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Analyze this material with deep mentorship guidelines:\n\n${analyzedText}` }
          ],
          temperature: 0.35, // Keeps output logical yet allows for conversational tutoring flow
          response_format: { type: 'json_object' }, // Enforce JSON output compliance
          max_tokens: 5000 // Large output token buffer for longer analytical structures
        }),
        signal: abortController.signal
      });
    } catch (fetchError) {
      if (fetchError.name === 'AbortError') {
        return res.status(504).json({
          success: false,
          error: 'Beacon Timeout: This document contains deep concepts that are taking longer to analyze. Try focusing on a smaller section or retry in a moment.'
        });
      }
      throw fetchError;
    } finally {
      clearTimeout(timeoutId);
    }

    // 9. Handle Groq Error Responses
    if (!groqResponse.ok) {
      const errorPayload = await groqResponse.json().catch(() => ({}));
      console.error(`[GROQ API ERROR] Status Code: ${groqResponse.status}`, JSON.stringify(errorPayload));

      return res.status(502).json({
        success: false,
        error: 'Upstream AI Service Error: Groq API rejected the analysis request.',
        details: errorPayload
      });
    }

    const responseData = await groqResponse.json();
    const rawAiResponse = responseData.choices?.[0]?.message?.content;

    if (!rawAiResponse) {
      console.error('[BEACON BACKEND ERROR] Empty response payload received from Groq:', responseData);
      return res.status(502).json({
        success: false,
        error: 'Invalid AI Payload: Groq returned a response without valid content generation.'
      });
    }

    // 10. Safe Schema Formatting and Parsing
    let parsedAnalysis;
    try {
      // Strip out markdown wrap formatting if any edge case occurs
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

    // 11. Inject Truncation Metadata Warning if applicable
    if (wasTruncated && parsedAnalysis) {
      parsedAnalysis.truncated_warning = "The uploaded document was extremely large. Beacon has focused this comprehensive analysis on the initial sections of your study material.";
    }

    // 12. Return Success Result
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
