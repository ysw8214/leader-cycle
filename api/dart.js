module.exports = async function handler(req, res) {
  try {
    const apiKey = process.env.DART_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        error: "DART_API_KEY 환경변수가 없습니다."
      });
    }

    const code = String(req.query.code || "005930").trim();

    const corpMap = {
      "005930": "00126380"
    };

    const corpCode =
      String(req.query.corpCode || corpMap[code] || "").trim();

    if (!corpCode) {
      return res.status(400).json({
        ok: false,
        error: "corpCode가 필요합니다.",
        example:
          "/api/dart?code=005930&corpCode=00126380"
      });
    }

    // ==============================
    // 기업 기본정보
    // ==============================

    const companyUrl =
      "https://opendart.fss.or.kr/api/company.json" +
      "?crtfc_key=" +
      encodeURIComponent(apiKey) +
      "&corp_code=" +
      encodeURIComponent(corpCode);

    const companyResponse = await fetch(companyUrl);
    const company = await companyResponse.json();

    if (company.status !== "000") {
      return res.status(502).json({
        ok: false,
        step: "company",
        status: company.status,
        message: company.message
      });
    }

    // ==============================
    // 최근 6개월 공시
    // ==============================

    const today = new Date();

    const endDate =
      today.getFullYear().toString() +
      String(today.getMonth() + 1).padStart(2, "0") +
      String(today.getDate()).padStart(2, "0");

    const sixMonthsAgo = new Date(today);

    sixMonthsAgo.setMonth(
      sixMonthsAgo.getMonth() - 6
    );

    const beginDate =
      sixMonthsAgo.getFullYear().toString() +
      String(sixMonthsAgo.getMonth() + 1).padStart(2, "0") +
      String(sixMonthsAgo.getDate()).padStart(2, "0");

    const listUrl =
      "https://opendart.fss.or.kr/api/list.json" +
      "?crtfc_key=" +
      encodeURIComponent(apiKey) +
      "&corp_code=" +
      encodeURIComponent(corpCode) +
      "&bgn_de=" +
      beginDate +
      "&end_de=" +
      endDate +
      "&page_count=20";

    const listResponse = await fetch(listUrl);
    const listData = await listResponse.json();

    let disclosures = [];

    if (
      listData.status === "000" &&
      Array.isArray(listData.list)
    ) {
      disclosures = listData.list.map(function (item) {
        return {
          receiptNumber: item.rcept_no || null,
          reportName: item.report_nm || null,
          corporationName: item.corp_name || null,
          submitter: item.flr_nm || null,
          receiptDate: item.rcept_dt || null,
          remark: item.rm || null
        };
      });
    }

    // ==============================
    // 공시 위험 신호
    // ==============================

    const riskWords = [
      "유상증자",
      "전환사채",
      "신주인수권",
      "횡령",
      "배임",
      "소송",
      "관리종목",
      "상장폐지"
    ];

    const positiveWords = [
      "단일판매",
      "공급계약",
      "자기주식취득",
      "배당",
      "신규시설투자"
    ];

    const risks = [];
    const positives = [];

    disclosures.forEach(function (item) {
      const title = String(item.reportName || "");

      riskWords.forEach(function (word) {
        if (title.indexOf(word) !== -1) {
          risks.push(title);
        }
      });

      positiveWords.forEach(function (word) {
        if (title.indexOf(word) !== -1) {
          positives.push(title);
        }
      });
    });

    // ==============================
    // 응답
    // ==============================

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=1800, stale-while-revalidate=3600"
    );

    return res.status(200).json({
      ok: true,

      version: "DART_V2",

      company: {
        corpCode: company.corp_code,
        corpName: company.corp_name,
        corpNameEng: company.corp_name_eng,
        stockCode: company.stock_code,
        ceoName: company.ceo_nm,
        corporationClass: company.corp_cls,
        establishmentDate: company.est_dt,
        fiscalMonth: company.acc_mt
      },

      disclosureAnalysis: {
        total: disclosures.length,
        riskCount: risks.length,
        positiveCount: positives.length,
        risks: risks.slice(0, 5),
        positives: positives.slice(0, 5)
      },

      disclosures: disclosures.slice(0, 10),

      dart: {
        connected: true,
        status: company.status,
        message: company.message
      }
    });
  } catch (error) {
    console.error("DART ERROR", error);

    return res.status(500).json({
      ok: false,
      version: "DART_V2",
      error: String(
        error && error.message
          ? error.message
          : error
      )
    });
  }
};
