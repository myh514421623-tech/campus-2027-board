// EdgeOne Makers Edge Function
// 路由：/api/match （对应 edge-functions/api/match.js）
// 环境变量：DEEPSEEK_API_KEY（在 EdgeOne 控制台配置）

export default async function onRequestPost(context) {
  const { request, env } = context;

  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });

  try {
    const body = await request.json();
    const { resume, jobs } = body;
    if (!resume || !jobs || !Array.isArray(jobs) || jobs.length === 0) {
      return json({ error: 'missing resume or jobs array' }, 400);
    }

    const apiKey = env.DEEPSEEK_API_KEY;
    if (!apiKey) return json({ error: 'API key not configured' }, 500);

    const jobsText = jobs
      .map((j, i) => `[${i}] ${j.company} — ${j.title} | 类型:${j.major} | 地点:${j.location} | 网申:${j.start} | 截止:${j.deadline}`)
      .join('\n');

    const prompt = `你是一位资深校招职业规划顾问。请根据以下简历内容，从岗位列表中选出 Top 8 最适合该候选人的岗位并分析。

## 岗位列表（共${jobs.length}个）：
${jobsText}

## 候选人简历：
${resume}

## 要求：
1. 从岗位列表中严格挑选 8 个最匹配的岗位（不能编造不存在的岗位）
2. 这 8 个岗位必须尽可能覆盖不同的岗位类别（类型字段），避免集中在同一类岗位（例如不要全是审计）
3. 每个推荐包含：
   - 岗位编号（列表中的 [N]）
   - 匹配度评分（1-10）
   - 匹配分析（3-4句话：为什么匹配、优势在哪、需要注意什么）
   - 差距建议（如果存在差距，1-2句具体建议）
4. 输出严格 JSON 格式，不要 Markdown 代码块标记：

{"matches":[{"id":编号,"score":分数,"analysis":"分析","gap":"建议"},...],"summary":"总体评价(2-3句)"}`;

    const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: '你是一个专业的校招求职顾问，擅长分析简历与岗位匹配度。严格输出 JSON，不输出任何 Markdown 标记。' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 3000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!r.ok) {
      const err = await r.text();
      return json({ error: `DeepSeek API error: ${r.status}`, detail: err.slice(0, 200) }, r.status);
    }

    const data = await r.json();
    const content = data.choices?.[0]?.message?.content;
    const result = JSON.parse(content);

    // 按大类去重，同类岗位只保留最高分；再按分数降序取前 5（大类互不相同）
    const seen = new Set();
    const deduped = [];
    for (const m of result.matches || []) {
      const job = jobs[m.id];
      if (!job) continue;
      if (seen.has(job.major)) continue;
      seen.add(job.major);
      deduped.push({ ...m, job });
    }
    deduped.sort((a, b) => (b.score || 0) - (a.score || 0));
    result.matches = deduped.slice(0, 5);

    return json(result);
  } catch (e) {
    return json({ error: 'match failed', detail: e.message }, 500);
  }
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
