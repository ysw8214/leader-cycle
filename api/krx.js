export default async function handler(req, res) {
  try {
    const apiKey = process.env.KRX_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        error: "KRX_API_KEY가 설정되지 않았습니다."
      });
    }

    // 주소에 ?date=20200414 처럼 넣으면 해당 날짜 조회
    const date = req.query.date || "20200414";

    // KRX 명세에 나온 실제 API 주소
    const url =
      `https://data-dbg.krx.co.kr/svc/apis/sto/stk_bydd_trd?basDd=${date}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        AUTH_KEY: apiKey
      }
    });

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      return res.status(500).json({
        ok: false,
        error: "KRX 응답을 JSON으로 변환하지 못했습니다.",
        status: response.status,
        raw: text
      });
    }

    return res.status(200).json({
      ok: response.ok,
      status: response.status,
      date: date,
      count: data.OutBlock_1?.length || 0,
      data: data.OutBlock_1 || [],
      raw: data
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
