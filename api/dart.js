module.exports = async function handler(req, res) {
  try {
    const apiKey = process.env.DART_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        error: "DART_API_KEY가 없습니다."
      });
    }

    /*
      우선 연결 테스트용.
      삼성전자 DART 고유번호 = 00126380

      corp_code를 직접 받을 수도 있게 함.
    */

    const corpCode = String(
      req.query.corp_code || "00126380"
    ).trim();

    if (!/^\d{8}$/.test(corpCode)) {
      return res.status(400).json({
        ok: false,
        error: "corp_code는 8자리 DART 고유번호여야 합니다."
      });
    }

    /*
      DART 기업개황 API

      여기서 API KEY가 정상인지,
      DART 고유번호가 정상인지 먼저 확인.
    */

    const url =
      "https://opendart.fss.or.kr/api/company.json" +
      `?crtfc_key=${encodeURIComponent(apiKey)}` +
      `&corp_code=${encodeURIComponent(corpCode)}`;

    const response = await fetch(url);

    let data;

    try {
      data = await response.json();
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: "DART 응답을 JSON으로 읽지 못했습니다."
      });
    }

    /*
      OpenDART 정상 status = 000
    */

    if (!response.ok || data.status !== "000") {
      return res.status(500).json({
        ok: false,
        error: "DART API 호출 실패",
        dartStatus: data.status || null,
        dartMessage: data.message || null
      });
    }

    /*
      API KEY 자체는 절대 응답에 포함하지 않음.
    */

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=86400, stale-while-revalidate=604800"
    );

    return res.status(200).json({
      ok: true,

      version: "DART_TEST_V1",

      company: {
        corpCode: data.corp_code || corpCode,
        corpName: data.corp_name || "",
        corpNameEng: data.corp_name_eng || "",
        stockCode: data.stock_code || "",
        ceoName: data.ceo_nm || "",
        corporationClass: data.corp_cls || "",
        establishmentDate: data.est_dt || "",
        fiscalMonth: data.acc_mt || ""
      },

      dart: {
        connected: true,
        status: data.status,
        message: data.message
      },

      nextStep:
        "DART 연결 성공. 다음 단계에서 재무제표와 주요 공시를 연결합니다."
    });

  } catch (error) {
    console.error("DART ERROR", error);

    return res.status(500).json({
      ok: false,
      error: String(
        error && error.message
          ? error.message
          : error
      )
    });
  }
};
