export const config = { runtime: 'nodejs22.x', maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') return res.status(415).json({ error: 'JSON only' });

  const { resume, jobs } = req.body;
  if (!resume || !jobs || !Array.isArray(jobs) || jobs.length === 0) {
    return res.status(400).json({ error: 'missing resume or jobs array' });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const jobsText = jobs.map((j, i) =>
    `[${i}] ${j.c} — ${j.t} | 类型:${j.g} | 地点:${j.l} | 网申:${j.s} | 截止:${j.d}`
  ).join('\n');

  const prompt = `你是一位资深校招职业规划顾问。请根据以下简历内容，从岗位列表中选出 Top 5 最适合该候选人的岗位并分析。

## 岗位列表（共${jobs.length}个）：
${jobsText}

## 候选人简历：
${resume}

## 要求：
1. 从岗位列表中严格挑选 5 个最匹配的岗位（不能编造不存在的岗位）
2. 每个推荐包含：
   - 岗位编号（列表中的 [N]）
   - 匹配度评分（1-10）
   - 匹配分析（3-4句话：为什么匹配、优势在哪、需要注意什么）
   - 差距建议（如果存在差距，1-2句具体建议）
3. 输出严格 JSON 格式，不要 Markdown 代码块标记：

{"matches":[{"id":编号,"score":分数,"analysis":"分析","gap":"建议"},...],"summary":"总体评价(2-3句)"}`;

  try {
    const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: '你是一个专业的校招求职顾问，擅长分析简历与岗位匹配度。严格输出 JSON，不输出任何 Markdown 标记。' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 3000,
        response_format: { type: 'json_object' }
      })
    });

    if (!r.ok) {
      const err = await r.text();
      return res.status(r.status).json({ error: `DeepSeek API error: ${r.status}`, detail: err.slice(0, 200) });
    }

    const data = await r.json();
    const content = data.choices?.[0]?.message?.content;
    const result = JSON.parse(content);

    // map indices back to actual job objects
    result.matches = result.matches.map(m => ({
      ...m,
      job: jobs[m.id] || null
    }));

    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: 'match failed', detail: e.message });
  }
}
