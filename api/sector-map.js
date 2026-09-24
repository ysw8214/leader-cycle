/* =========================================================
   LEADER CYCLE - SECTOR MAP V1

   역할
   ---------------------------------------------------------
   종목코드 → 투자자 관점 Primary Sector 변환

   원칙
   1. 테마 분류 금지
   2. 종목당 Primary Sector 1개
   3. 시장 데이터와 산업분류 데이터 분리
   4. 미분류 종목은 UNKNOWN 처리
   5. sector-scan.js에서 공통 사용

   IMPORTANT
   ---------------------------------------------------------
   STOCK_SECTOR_MAP에는 검증된 산업분류 데이터만 넣는다.
   추측으로 종목을 분류하지 않는다.
========================================================= */


/* =========================================================
   STANDARD SECTORS

   투자자 관점의 고정 산업 분류
========================================================= */

const SECTORS = Object.freeze({

  SEMICONDUCTOR: {
    id: "SEMICONDUCTOR",
    name: "반도체"
  },

  DISPLAY: {
    id: "DISPLAY",
    name: "디스플레이"
  },

  IT_HARDWARE: {
    id: "IT_HARDWARE",
    name: "IT하드웨어"
  },

  SOFTWARE: {
    id: "SOFTWARE",
    name: "소프트웨어"
  },

  INTERNET: {
    id: "INTERNET",
    name: "인터넷"
  },

  TELECOM: {
    id: "TELECOM",
    name: "통신"
  },

  AUTO: {
    id: "AUTO",
    name: "자동차"
  },

  AUTO_PARTS: {
    id: "AUTO_PARTS",
    name: "자동차부품"
  },

  BATTERY: {
    id: "BATTERY",
    name: "2차전지"
  },

  CHEMICAL: {
    id: "CHEMICAL",
    name: "화학"
  },

  STEEL: {
    id: "STEEL",
    name: "철강"
  },

  NONFERROUS: {
    id: "NONFERROUS",
    name: "비철금속"
  },

  MACHINERY: {
    id: "MACHINERY",
    name: "기계"
  },

  ELECTRICAL_EQUIPMENT: {
    id: "ELECTRICAL_EQUIPMENT",
    name: "전력기기"
  },

  ROBOTICS: {
    id: "ROBOTICS",
    name: "로봇·자동화"
  },

  SHIPBUILDING: {
    id: "SHIPBUILDING",
    name: "조선"
  },

  DEFENSE: {
    id: "DEFENSE",
    name: "방산"
  },

  AEROSPACE: {
    id: "AEROSPACE",
    name: "항공·우주"
  },

  CONSTRUCTION: {
    id: "CONSTRUCTION",
    name: "건설"
  },

  BUILDING_MATERIALS: {
    id: "BUILDING_MATERIALS",
    name: "건자재"
  },

  ENERGY: {
    id: "ENERGY",
    name: "에너지"
  },

  UTILITIES: {
    id: "UTILITIES",
    name: "유틸리티"
  },

  BIO: {
    id: "BIO",
    name: "바이오"
  },

  PHARMA: {
    id: "PHARMA",
    name: "제약"
  },

  HEALTHCARE: {
    id: "HEALTHCARE",
    name: "헬스케어"
  },

  BANK: {
    id: "BANK",
    name: "은행"
  },

  SECURITIES: {
    id: "SECURITIES",
    name: "증권"
  },

  INSURANCE: {
    id: "INSURANCE",
    name: "보험"
  },

  FINANCE: {
    id: "FINANCE",
    name: "기타금융"
  },

  RETAIL: {
    id: "RETAIL",
    name: "유통"
  },

  FOOD: {
    id: "FOOD",
    name: "음식료"
  },

  CONSUMER: {
    id: "CONSUMER",
    name: "소비재"
  },

  COSMETICS: {
    id: "COSMETICS",
    name: "화장품"
  },

  FASHION: {
    id: "FASHION",
    name: "의류"
  },

  MEDIA: {
    id: "MEDIA",
    name: "미디어·콘텐츠"
  },

  LEISURE: {
    id: "LEISURE",
    name: "호텔·레저"
  },

  TRANSPORT: {
    id: "TRANSPORT",
    name: "운송"
  },

  HOLDING: {
    id: "HOLDING",
    name: "지주"
  },

  OTHER: {
    id: "OTHER",
    name: "기타"
  }

});


/* =========================================================
   VERIFIED STOCK → SECTOR MAP

   여기에 검증 완료된 종목만 저장한다.

   code: sector ID

   예:
   "005930": "SEMICONDUCTOR"

   아래 데이터는 시스템 연결 테스트용 핵심 종목이다.
   전체 universe는 별도 검증 데이터로 확장한다.
========================================================= */

const STOCK_SECTOR_MAP = Object.freeze({

  /* -------------------------
     반도체
  ------------------------- */

  "005930": "SEMICONDUCTOR", // 삼성전자
  "000660": "SEMICONDUCTOR", // SK하이닉스
  "042700": "SEMICONDUCTOR", // 한미반도체
  "403870": "SEMICONDUCTOR", // HPSP


  /* -------------------------
     자동차
  ------------------------- */

  "005380": "AUTO", // 현대차
  "000270": "AUTO", // 기아


  /* -------------------------
     2차전지
  ------------------------- */

  "373220": "BATTERY", // LG에너지솔루션
  "003670": "BATTERY", // 포스코퓨처엠


  /* -------------------------
     전력기기
  ------------------------- */

  "267260": "ELECTRICAL_EQUIPMENT", // HD현대일렉트릭
  "298040": "ELECTRICAL_EQUIPMENT", // 효성중공업
  "010120": "ELECTRICAL_EQUIPMENT", // LS ELECTRIC


  /* -------------------------
     조선
  ------------------------- */

  "009540": "SHIPBUILDING", // HD한국조선해양
  "042660": "SHIPBUILDING", // 한화오션
  "010140": "SHIPBUILDING", // 삼성중공업


  /* -------------------------
     방산
  ------------------------- */

  "012450": "DEFENSE", // 한화에어로스페이스
  "079550": "DEFENSE", // LIG넥스원
  "064350": "DEFENSE", // 현대로템


  /* -------------------------
     항공·우주
  ------------------------- */

  "047810": "AEROSPACE", // 한국항공우주
  "272210": "AEROSPACE", // 한화시스템


  /* -------------------------
     로봇·자동화
  ------------------------- */

  "454910": "ROBOTICS", // 두산로보틱스
  "277810": "ROBOTICS", // 레인보우로보틱스


  /* -------------------------
     바이오
  ------------------------- */

  "207940": "BIO", // 삼성바이오로직스
  "068270": "BIO" // 셀트리온

});


/* =========================================================
   CODE NORMALIZER
========================================================= */

function normalizeCode(value) {

  const raw =
    String(value || "")
      .trim();

  if (/^\d{6}$/.test(raw)) {
    return raw;
  }

  const match =
    raw.match(/(\d{6})/);

  return match
    ? match[1]
    : raw;
}


/* =========================================================
   GET SECTOR ID
========================================================= */

function getSectorId(code) {

  const normalized =
    normalizeCode(code);

  return (
    STOCK_SECTOR_MAP[
      normalized
    ] ||
    null
  );
}


/* =========================================================
   GET SECTOR
========================================================= */

function getSector(code) {

  const normalized =
    normalizeCode(code);

  const sectorId =
    STOCK_SECTOR_MAP[
      normalized
    ];

  if (!sectorId) {

    return {
      id: "UNKNOWN",
      name: "미분류",
      classified: false
    };
  }

  const sector =
    SECTORS[
      sectorId
    ];

  if (!sector) {

    return {
      id: "UNKNOWN",
      name: "미분류",
      classified: false
    };
  }

  return {
    ...sector,
    classified: true
  };
}


/* =========================================================
   GET STOCK CLASSIFICATION
========================================================= */

function classifyStock(stock) {

  const code =
    normalizeCode(
      stock?.code
    );

  const sector =
    getSector(code);

  return {
    ...stock,

    code,

    sectorId:
      sector.id,

    sector:
      sector.name,

    sectorClassified:
      sector.classified
  };
}


/* =========================================================
   CLASSIFY STOCK ARRAY
========================================================= */

function classifyStocks(stocks) {

  if (!Array.isArray(stocks)) {
    return [];
  }

  return stocks.map(
    classifyStock
  );
}


/* =========================================================
   GROUP BY SECTOR
========================================================= */

function groupBySector(stocks) {

  const classified =
    classifyStocks(stocks);

  const groups = {};

  for (
    const stock of classified
  ) {

    const sectorId =
      stock.sectorId ||
      "UNKNOWN";

    if (!groups[sectorId]) {

      groups[sectorId] = {
        id:
          sectorId,

        name:
          stock.sector ||
          "미분류",

        stocks: []
      };
    }

    groups[
      sectorId
    ].stocks.push(
      stock
    );
  }

  return groups;
}


/* =========================================================
   CLASSIFICATION STATS

   전체 시장 중 얼마나 분류됐는지 확인하는 용도.

   중요:
   coverage가 낮으면 Sector Scanner 결과를
   최종 결과로 사용하면 안 된다.
========================================================= */

function getClassificationStats(
  stocks
) {

  if (!Array.isArray(stocks)) {

    return {
      total: 0,
      classified: 0,
      unclassified: 0,
      coverage: 0
    };
  }

  let classified = 0;

  for (
    const stock of stocks
  ) {

    if (
      getSectorId(
        stock?.code
      )
    ) {
      classified++;
    }
  }

  const total =
    stocks.length;

  const unclassified =
    total -
    classified;

  const coverage =
    total > 0
      ? (
          classified /
          total
        ) * 100
      : 0;

  return {
    total,

    classified,

    unclassified,

    coverage:
      Number(
        coverage.toFixed(2)
      )
  };
}


/* =========================================================
   LIST UNCLASSIFIED

   신규상장 / 누락종목 확인용
========================================================= */

function getUnclassifiedStocks(
  stocks
) {

  if (!Array.isArray(stocks)) {
    return [];
  }

  return stocks.filter(
    stock =>
      !getSectorId(
        stock?.code
      )
  );
}


/* =========================================================
   EXPORT
========================================================= */

module.exports = {

  SECTORS,

  STOCK_SECTOR_MAP,

  normalizeCode,

  getSectorId,

  getSector,

  classifyStock,

  classifyStocks,

  groupBySector,

  getClassificationStats,

  getUnclassifiedStocks

};
