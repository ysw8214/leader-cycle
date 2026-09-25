/* =========================================================
   LEADER CYCLE - SECTOR MAP V4 CLEAN

   sector-master.js = 검증된 종목 DB
   sector-map.js    = 분류 엔진
   sector-scan.js   = 섹터 집계

   Priority
   1. MASTER
   2. SAFE NAME INFERENCE
   3. UNKNOWN
========================================================= */

const {
  SECTOR_MASTER
} = require("../data/sector-master");


/* =========================================================
   STANDARD SECTORS
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
   NORMALIZE CODE
========================================================= */

function normalizeCode(value) {

  const raw =
    String(value || "").trim();

  if (/^\d{6}$/.test(raw)) {
    return raw;
  }

  const match =
    raw.match(/\d{6}/);

  return match
    ? match[0]
    : raw;
}


/* =========================================================
   NORMALIZE NAME
========================================================= */

function normalizeName(value) {

  return String(value || "")
    .trim()
    .toUpperCase();
}


/* =========================================================
   SAFE NAME INFERENCE

   이름만으로 비교적 명확한 경우만 사용.
========================================================= */

function inferSectorFromName(value) {

  const name =
    normalizeName(value);

  if (!name) {
    return null;
  }


  /* 증권 */

  if (
    /증권/.test(name) ||
    /SECURITIES/.test(name)
  ) {
    return "SECURITIES";
  }


  /* 보험 */

  if (
    /손해보험/.test(name) ||
    /생명/.test(name) ||
    /화재/.test(name) ||
    /INSURANCE/.test(name)
  ) {
    return "INSURANCE";
  }


  /* 금융 */

  if (
    /금융지주/.test(name) ||
    /FINANCIAL GROUP/.test(name)
  ) {
    return "FINANCE";
  }


  /* 은행 */

  if (
    /은행/.test(name) ||
    /BANK/.test(name)
  ) {
    return "BANK";
  }


  /* 제약 */

  if (
    /제약/.test(name) ||
    /PHARM/.test(name)
  ) {
    return "PHARMA";
  }


  /* 바이오 */

  if (
    /바이오/.test(name) ||
    /BIO/.test(name)
  ) {
    return "BIO";
  }


  /* 로봇 */

  if (
    /로봇/.test(name) ||
    /로보틱스/.test(name) ||
    /ROBOTICS/.test(name)
  ) {
    return "ROBOTICS";
  }


  /* 조선 */

  if (
    /조선/.test(name)
  ) {
    return "SHIPBUILDING";
  }


  /* 건설 */

  if (
    /건설/.test(name)
  ) {
    return "CONSTRUCTION";
  }


  /* 화장품 */

  if (
    /코스메틱/.test(name) ||
    /COSMETIC/.test(name)
  ) {
    return "COSMETICS";
  }


  return null;
}


/* =========================================================
   RESOLVE SECTOR ID
========================================================= */

function resolveSectorId(code, name) {

  const normalizedCode =
    normalizeCode(code);


  const masterSector =
    SECTOR_MASTER &&
    SECTOR_MASTER[normalizedCode];


  if (
    masterSector &&
    SECTORS[masterSector]
  ) {
    return masterSector;
  }


  const inferred =
    inferSectorFromName(name);


  if (
    inferred &&
    SECTORS[inferred]
  ) {
    return inferred;
  }


  return null;
}


/* =========================================================
   GET SECTOR ID
========================================================= */

function getSectorId(code, name) {

  return resolveSectorId(
    code,
    name
  );
}


/* =========================================================
   GET SECTOR
========================================================= */

function getSector(code, name) {

  const normalizedCode =
    normalizeCode(code);


  const sectorId =
    resolveSectorId(
      normalizedCode,
      name
    );


  if (!sectorId) {

    return {
      id: "UNKNOWN",
      name: "미분류",
      classified: false,
      source: "UNKNOWN"
    };
  }


  const sector =
    SECTORS[sectorId];


  if (!sector) {

    return {
      id: "UNKNOWN",
      name: "미분류",
      classified: false,
      source: "UNKNOWN"
    };
  }


  const isMaster =
    Boolean(
      SECTOR_MASTER &&
      SECTOR_MASTER[normalizedCode]
    );


  return {
    id: sector.id,
    name: sector.name,
    classified: true,
    source:
      isMaster
        ? "MASTER"
        : "NAME_INFERENCE"
  };
}


/* =========================================================
   CLASSIFY STOCK
========================================================= */

function classifyStock(stock) {

  const safeStock =
    stock &&
    typeof stock === "object"
      ? stock
      : {};


  const code =
    normalizeCode(
      safeStock.code
    );


  const sector =
    getSector(
      code,
      safeStock.name
    );


  return {
    ...safeStock,

    code,

    sectorId:
      sector.id,

    sector:
      sector.name,

    sectorClassified:
      sector.classified,

    sectorSource:
      sector.source
  };
}


/* =========================================================
   CLASSIFY STOCKS
========================================================= */

function classifyStocks(stocks) {

  if (!Array.isArray(stocks)) {
    return [];
  }


  return stocks.map(
    stock =>
      classifyStock(stock)
  );
}


/* =========================================================
   GROUP BY SECTOR
========================================================= */

function groupBySector(stocks) {

  const classified =
    classifyStocks(stocks);


  const groups = {};


  for (const stock of classified) {

    const sectorId =
      stock.sectorId ||
      "UNKNOWN";


    if (!groups[sectorId]) {

      groups[sectorId] = {
        id: sectorId,

        name:
          stock.sector ||
          "미분류",

        stocks: []
      };
    }


    groups[sectorId]
      .stocks
      .push(stock);
  }


  return groups;
}


/* =========================================================
   CLASSIFICATION STATS
========================================================= */

function getClassificationStats(stocks) {

  if (!Array.isArray(stocks)) {

    return {
      total: 0,
      classified: 0,
      unclassified: 0,
      coverage: 0,
      master: 0,
      inferred: 0
    };
  }


  let classified = 0;
  let master = 0;
  let inferred = 0;


  for (const stock of stocks) {

    const result =
      classifyStock(stock);


    if (!result.sectorClassified) {
      continue;
    }


    classified++;


    if (
      result.sectorSource ===
      "MASTER"
    ) {
      master++;
    }


    if (
      result.sectorSource ===
      "NAME_INFERENCE"
    ) {
      inferred++;
    }
  }


  const total =
    stocks.length;


  const unclassified =
    total - classified;


  const coverage =
    total > 0
      ? (classified / total) * 100
      : 0;


  return {
    total,

    classified,

    unclassified,

    coverage:
      Number(
        coverage.toFixed(2)
      ),

    master,

    inferred
  };
}


/* =========================================================
   UNCLASSIFIED STOCKS
========================================================= */

function getUnclassifiedStocks(stocks) {

  if (!Array.isArray(stocks)) {
    return [];
  }


  return stocks.filter(
    stock => {

      const result =
        classifyStock(stock);

      return (
        !result.sectorClassified
      );
    }
  );
}


/* =========================================================
   EXPORT
========================================================= */

module.exports = {

  SECTORS,

  SECTOR_MASTER,

  STOCK_SECTOR_MAP:
    SECTOR_MASTER,

  normalizeCode,

  normalizeName,

  inferSectorFromName,

  resolveSectorId,

  getSectorId,

  getSector,

  classifyStock,

  classifyStocks,

  groupBySector,

  getClassificationStats,

  getUnclassifiedStocks
};
