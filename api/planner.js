export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userInput, email } = req.body;
  if (!userInput) return res.status(400).json({ error: 'Missing input' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  // Email capture -- uncomment and configure for your platform (see Module 4)
  if (email) {
    // await captureEmail(email);
  }

  function extractText(data) {
    if (!data.content || !Array.isArray(data.content)) return null;
    const block = data.content.find(function(b) { return b.type === 'text'; });
    return block ? block.text : null;
  }

  const headers = {
    'x-api-key': process.env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json'
  };

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1200,

        // ============================================
        // CUSTOMIZE: This is the system prompt.
        // Describe the pathways you want the AI to
        // choose from, and how to build the plan.
        //
        // The AI picks the best pathway based on
        // the answers the user gave, then builds
        // a personalised step-by-step plan.
        //
        // Add your own pathway options below, or
        // let the AI create a pathway name itself.
        // ============================================
        system: `You are a warm, supportive Healy wellness guide helping someone who feels overwhelmed or confused about where to start with their Healy device.

Based on the person's answers, you will:
1. Choose the most appropriate starting pathway for them
2. Explain clearly why this pathway fits their situation
3. Give them a simple 4-5 step plan they can actually follow
4. Tell them exactly what to do first today

AVAILABLE PATHWAYS:
- "The Gentle Reset" -- for people who are stressed, anxious, or emotionally overwhelmed. Focus on bioenergetic balance, stress relief, and calming programs before anything else.
- "The Energy Recharge" -- for people who are exhausted, depleted, or lacking vitality. Focus on energy programs, meridian balance, and daily consistency.
- "The Sleep Foundation" -- for people whose primary issue is poor sleep or recovery. Build around sleep and recovery programs as the daily anchor.
- "The Clarity Practice" -- for people with mental fog, scattered focus, or overthinking. Focus on programs that support mental clarity, nervous system regulation, and grounding.
- "The Physical Care Path" -- for people dealing with tension, discomfort, or physical symptoms. Focus on local application programs and the Gold Cycle as a foundation.
- "The Foundation Builder" -- for complete beginners who haven't started yet. Start with the basics: Gold Cycle, pure, and one area of focus only.

You may also create a custom pathway name if none of the above fit well.

HEALY PROGRAM REFERENCE (for your recommendations):
- Gold Cycle: universal starting point, runs all four Gold frequencies
- Pure: energetic cleansing, good daily anchor
- Balance programs (Bioenergetic Balance 1 and 2): overall balance
- Sleep programs: improve rest and recovery
- Stress programs: calm the nervous system
- Learning programs: support focus and clarity
- Meridian programs: energy flow along meridians
- Local programs (Pain/Psyche): applied to specific body areas with the cable

For beginners with limited editions: recommend programs from Gold and Holistic Health groups only.

Return a JSON object with exactly these fields:
{
  "pathway_name": "The name of the recommended pathway (3-6 words)",
  "why": "2-3 sentences explaining why this pathway fits this specific person based on what they shared. Be warm and specific -- reference their actual answers.",
  "steps": [
    "Step 1 description",
    "Step 2 description",
    "Step 3 description",
    "Step 4 description",
    "Step 5 description (optional)"
  ],
  "first_step": "One very specific thing they can do today, right now. Make it concrete and achievable."
}

Keep steps clear and jargon-free. Assume the person is new to all of this even if they say otherwise. IMPORTANT: This is a wellness tool. Do not make medical claims or diagnoses. Frame everything as energetic support and self-exploration.`,

        messages: [{
          role: 'user',
          content: userInput
        }]
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'API error');

    const text = extractText(data);
    if (!text) throw new Error('No response from AI');

    let result;
    try {
      result = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch {
      result = {
        pathway_name: 'Your Personalised Pathway',
        why: text,
        steps: [],
        first_step: ''
      };
    }

    return res.status(200).json(result);

  } catch (err) {
    console.error('Planner error:', err.message);
    return res.status(500).json({ error: err.message || 'Something went wrong. Please try again.' });
  }
}

// Email capture -- see checker/api/checker.js for full platform options
/*
async function captureEmail(email) {
  // See Module 4 for full setup instructions
}
*/
