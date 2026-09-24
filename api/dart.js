module.exports = async function handler(req, res) {
  try {
    const API_KEY = process.env.DART_API_KEY;

    if (!API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "DART_API_KEY 환경변수가 없습니다."
      });
    }

    const stockCode = String(
      req.query.code || "005930"
    )
      .trim()
      .padStart(6, "0");

    // --------------------------------------------------
    // HELPERS
    // --------------------------------------------------

    const num = (value) => {
      if (
        value === null ||
        value === undefined ||
        value === ""
      ) {
        return null;
      }

      const cleaned = String(value)
        .replace(/,/g, "")
        .trim();

      const n = Number(cleaned);

      return Number.isFinite(n) ? n : null;
    };

    const fetchJson = async (url) => {
      const response = await fetch(url);

      const text = await response.text();

      let data;

      try {
        data = JSON.parse(text);
      } catch (error) {
        throw new Error(
          `DART JSON 파싱 실패: ${text.slice(0, 200)}`
        );
      }

      return {
        response,
        data
      };
    };

    // --------------------------------------------------
    // 1. 기업 고유번호 찾기
    //
    // DART company.json은 corp_code가 필요하므로
    // stock code -> corp code 매핑이 필요함.
    //
    // 우선 삼성전자 기본값을 지원하고
    // corpCode 직접 입력도 허용.
    // --------------------------------------------------

    let corpCode = String(
      req.query.corpCode || ""
    ).trim();

    // 삼성전자 기본 테스트
    if (!corpCode && stockCode === "005930") {
      corpCode = "00126380";
    }

    if (!corpCode) {
      return res.status(400).json({
        ok: false,
        error:
          "현재 버전에서는 corpCode가 필요합니다.",
        example:
          "/api/dart?code=005930&corpCode=00126380",
        stockCode
      });
    }

    // --------------------------------------------------
    // 2. 기업 개황
    // --------------------------------------------------

    const companyUrl =
      "https://opendart.fss.or.kr/api/company.json" +
      `?crtfc_key=${encodeURIComponent(API_KEY)}` +
      `&corp_code=${encodeURIComponent(corpCode)}`;

    const companyResult =
      await fetchJson(companyUrl);

    const company =
      companyResult.data;

    if (
      !companyResult.response.ok ||
      company.status !== "000"
    ) {
      return res.status(502).json({
        ok: false,
        source: "DART",
        step: "company",
        status: company.status || null,
        message:
          company.message ||
          "기업정보 조회 실패"
      });
    }

    // --------------------------------------------------
    // 3. 최근 주요 공시
    // --------------------------------------------------

    const now = new Date();

    const endDate =
      `${now.getFullYear()}` +
      `${String(now.getMonth() + 1).padStart(2, "0")}` +
      `${String(now.getDate()).padStart(2, "0")}`;

    const start = new Date(now);

    start.setDate(
      start.getDate() - 180
    );

    const startDate =
      `${start.getFullYear()}` +
      `${String(start.getMonth() + 1).padStart(2, "0")}` +
      `${String(start.getDate()).padStart(2, "0")}`;

    const disclosureUrl =
      "https://opendart.fss.or.kr/api/list.json" +
      `?crtfc_key=${encodeURIComponent(API_KEY)}` +
      `&corp_code=${encodeURIComponent(corpCode)}` +
      `&bgn_de=${startDate}` +
      `&end_de=${endDate}` +
      "&page_count=20";

    let disclosures = [];

    try {
      const disclosureResult =
        await fetchJson(disclosureUrl);

      if (
        disclosureResult.data.status === "000" &&
        Array.isArray(
          disclosureResult.data.list
        )
      ) {
        disclosures =
          disclosureResult.data.list.map(
            (item) => ({
              receiptNumber:
                item.rcept_no || null,

              reportName:
                item.report_nm || null,

              receiptDate:
                item.rcept_dt || null,

              corporationName:
                item.corp_name || null,

              submitter:
                item.flr_nm || null,

              remark:
                item.rm || null
            })
          );
      }
    } catch (error) {
      console.error(
        "DART disclosure error:",
        error
      );
    }

    // --------------------------------------------------
    // 4. 재무제표
    //
    // 가장 최근 사업연도부터 시도
    // --------------------------------------------------

    const currentYear =
      now.getFullYear();

    const yearsToTry = [
      currentYear - 1,
      currentYear - 2
    ];

    let financialYear = null;
    let financialRaw = [];

    for (const year of yearsToTry) {
      try {
        const financialUrl =
          "https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json" +
          `?crtfc_key=${encodeURIComponent(API_KEY)}` +
          `&corp_code=${encodeURIComponent(corpCode)}` +
          `&bsns_year=${year}` +
          "&reprt_code=11011" +
          "&fs_div=CFS";

        const financialResult =
          await fetchJson(financialUrl);

        if (
          financialResult.data.status === "000" &&
          Array.isArray(
            financialResult.data.list
          ) &&
          financialResult.data.list.length > 0
        ) {
          financialYear = year;
          financialRaw =
            financialResult.data.list;

   
