export default async function handler(req, res) {
  try {
    const apiKey = process.env.KRX_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        error: "KRX_API_KEY가 Vercel에 설정되지 않았습니다."
      });
    }

    // 날짜를 안 넣으면 기본값으로 최근 평일 후보 사용
    const date = req.query.date || "20260923";

    const url =
      "https://data-dbg.krx.co.kr/svc/apis/sto/stk_bydd_trd";

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "AUTH_KEY": apiKey,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        basDd: date
      })
    });

    if (!response.ok) {
      const text = await response.text();

      return res.status(response.status).json({
        ok: false,
        error: "KRX API 호출 실패",
        status: response.status,
        detail: text
      });
    }

    const data = await response.json();

    return res.status(200).json({
      ok: true,
      date,
      count: data.OutBlock_1?.length || 0,
      data: data.OutBlock_1 || data
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
