/* =========================================================
   LEADER CYCLE - SECTOR MAP V5

   목적
   ---------------------------------------------------------
   1. sector-master.js 검증 데이터 최우선
   2. 회사명으로 안전하게 판단 가능한 종목 자동 분류
   3. 잘못된 분류보다 UNKNOWN을 허용
   4. sector-scan.js 기존 인터페이스 완전 호환

   PRIORITY
   ---------------------------------------------------------
   MASTER
     ↓
   HIGH CONFIDENCE NAME RULE
     ↓
   MEDIUM CONFIDENCE NAME RULE
     ↓
   UNKNOWN
========================================================= */

const {
  SECTOR_MASTER
} = require("../data/sector-master");


/* =========================================================
   SECTORS
========================================================= */

const SECTORS = Object.freeze({

  SEMICONDUCTOR: { id: "SEMICONDUCTOR", name: "반도체" },
  DISPLAY: { id: "DISPLAY", name: "디스플레이" },

  IT_HARDWARE: { id: "IT_HARDWARE", name: "IT하드웨어" },
  SOFTWARE: { id: "SOFTWARE", name: "소프트웨어" },
  INTERNET: { id: "INTERNET", name: "인터넷" },
  TELECOM: { id: "TELECOM", name: "통신" },

  AUTO: { id: "AUTO", name: "자동차" },
  AUTO_PARTS: { id: "AUTO_PARTS", name: "자동차부품" },

  BATTERY: { id: "BATTERY", name: "2차전지" },

  CHEMICAL: { id: "CHEMICAL", name: "화학" },
  STEEL: { id: "STEEL", name: "철강" },
  NONFERROUS: { id: "NONFERROUS", name: "비철금속" },

  MACHINERY: { id: "MACHINERY", name: "기계" },
  ELECTRICAL_EQUIPMENT: {
    id: "ELECTRICAL_EQUIPMENT",
    name: "전력기기"
  },

  ROBOTICS: { id: "ROBOTICS", name: "로봇·자동화" },

  SHIPBUILDING: { id: "SHIPBUILDING", name: "조선" },
  DEFENSE: { id: "DEFENSE", name: "방산" },
  AEROSPACE: { id: "AEROSPACE", name: "항공·우주" },

  CONSTRUCTION: { id: "CONSTRUCTION", name: "건설" },

  BUILDING_MATERIALS: {
    id: "BUILDING_MATERIALS",
    name: "건자재"
  },

  ENERGY: { id: "ENERGY", name: "에너지" },
  UTILITIES: { id: "UTILITIES", name: "유틸리티" },

  BIO: { id: "BIO", name: "바이오" },
  PHARMA: { id: "PHARMA", name: "제약" },
  HEALTHCARE: { id: "HEALTHCARE", name: "헬스케어" },

  BANK: { id: "BANK", name: "은행" },
  SECURITIES: { id: "SECURITIES", name: "증권" },
  INSURANCE: { id: "INSURANCE", name: "보험" },
  FINANCE: { id: "FINANCE", name: "기타금융" },

  RETAIL: { id: "RETAIL", name: "유통" },
  FOOD: { id: "FOOD", name: "음식료" },
  CONSUMER: { id: "CONSUMER", name: "소비재" },

  COSMETICS: { id: "COSMETICS", name: "화장품" },
  FASHION: { id: "FASHION", name: "의류" },

  MEDIA: { id: "MEDIA", name: "미디어·콘텐츠" },
  LEISURE: { id: "LEISURE", name: "호텔·레저" },
  TRANSPORT: { id: "TRANSPORT", name: "운송" },

  HOLDING: { id: "HOLDING", name: "지주" },

  OTHER: { id: "OTHER", name: "기타" }
});


/* =========================================================
   NORMALIZE
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


function normalizeName(value) {

  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}


/* =========================================================
   RULE ENGINE

   순서 중요.
   더 구체적인 산업을 먼저 검사한다.
========================================================= */

const NAME_RULES = [

  /* -----------------------------------------------------
     금융
  ----------------------------------------------------- */

  {
    sector: "SECURITIES",
    regex:
      /(증권|SECURITIES|INVESTMENT증권|투자증권)/
  },

  {
    sector: "INSURANCE",
    regex:
      /(손해보험|생명보험|화재보험|화재|INSURANCE)/
  },

  {
    sector: "BANK",
    regex:
      /(은행|BANK)/
  },

  {
    sector: "FINANCE",
    regex:
      /(금융지주|금융그룹|FINANCIAL|캐피탈|CAPITAL|저축은행)/
  },


  /* -----------------------------------------------------
     바이오 / 제약 / 의료
  ----------------------------------------------------- */

  {
    sector: "PHARMA",
    regex:
      /(제약|약품|PHARM|PHARMA|PHARMACEUTICAL)/
  },

  {
    sector: "BIO",
    regex:
      /(바이오|BIO|셀트리온|GENE|GENOM|THERAPEUTICS|THERAPEUTIC)/
  },

  {
    sector: "HEALTHCARE",
    regex:
      /(헬스케어|HEALTHCARE|메디칼|메디컬|MEDICAL|의료기|덴탈|DENTAL)/
  },


  /* -----------------------------------------------------
     로봇 / 자동화
  ----------------------------------------------------- */

  {
    sector: "ROBOTICS",
    regex:
      /(로봇|로보틱스|ROBOT|ROBOTICS|AUTOMATION|자동화)/
  },


  /* -----------------------------------------------------
     반도체
  ----------------------------------------------------- */

  {
    sector: "SEMICONDUCTOR",
    regex:
      /(반도체|SEMICONDUCTOR|SEMICON|하이닉스|MICRON|WAFER|웨이퍼)/
  },


  /* -----------------------------------------------------
     디스플레이
  ----------------------------------------------------- */

  {
    sector: "DISPLAY",
    regex:
      /(디스플레이|DISPLAY|OLED)/
  },


  /* -----------------------------------------------------
     2차전지
  ----------------------------------------------------- */

  {
    sector: "BATTERY",
    regex:
      /(2차전지|배터리|BATTERY|리튬|LITHIUM|양극재|음극재|전해질|분리막)/
  },


  /* -----------------------------------------------------
     조선
  ----------------------------------------------------- */

  {
    sector: "SHIPBUILDING",
    regex:
      /(조선|SHIPBUILD|SHIPYARD|마린엔진|MARINEENGINE)/
  },


  /* -----------------------------------------------------
     항공 / 우주
  ----------------------------------------------------- */

  {
    sector: "AEROSPACE",
    regex:
      /(항공|우주|AEROSPACE|AIRLINES|에어로스페이스|SATELLITE|위성)/
  },


  /* -----------------------------------------------------
     방산
  ----------------------------------------------------- */

  {
    sector: "DEFENSE",
    regex:
      /(방산|DEFENSE|디펜스|DEFENCE)/
  },


  /* -----------------------------------------------------
     전력기기
  ----------------------------------------------------- */

  {
    sector: "ELECTRICAL_EQUIPMENT",
    regex:
      /(전기공업|전력기기|변압기|TRANSFORMER|전선|CABLE|케이블|일렉트릭|ELECTRIC)/
  },


  /* -----------------------------------------------------
     자동차 / 자동차부품

     PARTS를 먼저 검사
  ----------------------------------------------------- */

  {
    sector: "AUTO_PARTS",
    regex:
      /(오토텍|AUTOTECH|모터스부품|자동차부품|타이어|TIRE|휠|WHEEL|브레이크|BRAKE)/
  },

  {
    sector: "AUTO",
    regex:
      /(자동차|MOTORS|모터스|MOBIS|모비스)/
  },


  /* -----------------------------------------------------
     철강 / 금속
  ----------------------------------------------------- */

  {
    sector: "STEEL",
    regex:
      /(철강|STEEL|제철|특수강|강관)/
  },

  {
    sector: "NONFERROUS",
    regex:
      /(비철|알루미늄|ALUMINUM|ALUMINIUM|구리|COPPER|아연|ZINC)/
  },


  /* -----------------------------------------------------
     화학
  ----------------------------------------------------- */

  {
    sector: "CHEMICAL",
    regex:
      /(화학|CHEMICAL|CHEM|케미칼|케미컬|석유화학|PETROCHEM)/
  },


  /* -----------------------------------------------------
     건설 / 건자재
  ----------------------------------------------------- */

  {
    sector: "BUILDING_MATERIALS",
    regex:
      /(시멘트|CEMENT|레미콘|콘크리트|CONCRETE|벽산|유리|GLASS)/
  },

  {
    sector: "CONSTRUCTION",
    regex:
      /(건설|건업|CONSTRUCTION|ENGINEERING|엔지니어링)/
  },


  /* -----------------------------------------------------
     에너지 / 유틸리티
  ----------------------------------------------------- */

  {
    sector: "UTILITIES",
    regex:
      /(한국전력|지역난방|도시가스|GAS공사|전력공사)/
  },

  {
    sector: "ENERGY",
    regex:
      /(에너지|ENERGY|태양광|SOLAR|풍력|WINDPOWER|신재생|RENEWABLE)/
  },


  /* -----------------------------------------------------
     통신
  ----------------------------------------------------- */

  {
    sector: "TELECOM",
    regex:
      /(텔레콤|TELECOM|COMMUNICATION|통신)/
  },


  /* -----------------------------------------------------
     소프트웨어
  ----------------------------------------------------- */

  {
    sector: "SOFTWARE",
    regex:
      /(소프트웨어|SOFTWARE|SYSTEMS|시스템즈|솔루션|SOLUTION|정보기술)/
  },


  /* -----------------------------------------------------
     인터넷
  ----------------------------------------------------- */

  {
    sector: "INTERNET",
    regex:
      /(인터넷|INTERNET|온라인|ONLINE)/
  },


  /* -----------------------------------------------------
     IT HARDWARE
  ----------------------------------------------------- */

  {
    sector: "IT_HARDWARE",
    regex:
      /(전자|ELECTRONICS|테크놀로지|TECHNOLOGY|테크|TECH|컴퓨터|COMPUTER)/
  },


  /* -----------------------------------------------------
     기계
  ----------------------------------------------------- */

  {
    sector: "MACHINERY",
    regex:
      /(기계|MACHINERY|MACHINE|중공업|HEAVYINDUSTRIES|공작기계)/
  },


  /* -----------------------------------------------------
     화장품
  ----------------------------------------------------- */

  {
    sector: "COSMETICS",
    regex:
      /(화장품|코스메틱|COSMETIC|BEAUTY|뷰티)/
  },


  /* -----------------------------------------------------
     패션
  ----------------------------------------------------- */

  {
    sector: "FASHION",
    regex:
      /(패션|FASHION|어패럴|APPAREL|의류|섬유|TEXTILE)/
  },


  /* -----------------------------------------------------
     음식료
  ----------------------------------------------------- */

  {
    sector: "FOOD",
    regex:
      /(식품|FOOD|푸드|제과|음료|BEVERAGE|주류|BREWERY|맥주|소주|라면)/
  },


  /* -----------------------------------------------------
     유통
  ----------------------------------------------------- */

  {
    sector: "RETAIL",
    regex:
      /(백화점|마트|RETAIL|유통|쇼핑|SHOPPING|홈쇼핑)/
  },


  /* -----------------------------------------------------
     미디어
  ----------------------------------------------------- */

  {
    sector: "MEDIA",
    regex:
      /(미디어|MEDIA|엔터테인먼트|ENTERTAINMENT|스튜디오|STUDIO|콘텐츠|CONTENT|게임|GAME)/
  },


  /* -----------------------------------------------------
     호텔 / 레저
  ----------------------------------------------------- */

  {
    sector: "LEISURE",
    regex:
      /(호텔|HOTEL|리조트|RESORT|카지노|CASINO|레저|LEISURE|여행|TOUR)/
  },


  /* -----------------------------------------------------
     운송
  ----------------------------------------------------- */

  {
    sector: "TRANSPORT",
    regex:
      /(해운|SHIPPING|운수|운송|TRANSPORT|물류|LOGISTICS|택배)/
  },


  /* -----------------------------------------------------
     지주
  ----------------------------------------------------- */

  {
    sector: "HOLDING",
    regex:
      /(홀딩스|HOLDINGS|지주)/
  }

];


/* =========================================================
   INFERENCE
========================================================= */

function inferSectorFromName(value) {

  const name =
    normalizeName(value);

  if (!name) {
    return null;
  }


  for (const rule of NAME_RULES) {

    if (
      rule.regex.test(name) &&
      SECTORS[rule.sector]
    ) {

      return rule.sector;
    }
  }


  return null;
}


/* =========================================================
   RESOLVE
========================================================= */

function resolveSectorId(code, name) {

  const normalizedCode =
    normalizeCode(code);


  /*
    MASTER 최우선
  */

  const masterSector =
    SECTOR_MASTER?.[
      normalizedCode
    ];


  if (
    masterSector &&
    SECTORS[masterSector]
  ) {

    return masterSector;
  }


  /*
    NAME INFERENCE
  */

  const inferred =
    inferSectorFromName(
      name
    );


  if (
    inferred &&
    SECTORS[inferred]
  ) {

    return inferred;
  }


  return null;
}


/* =========================================================
   GET SECTOR
========================================================= */

function getSectorId(code, name) {

  return resolveSectorId(
    code,
    name
  );
}


function getSector(code, name) {

  const normalizedCode =
    normalizeCode(code);


  const masterSector =
    SECTOR_MASTER?.[
      normalizedCode
    ];


  if (
    masterSector &&
    SECTORS[masterSector]
  ) {

    return {
      ...SECTORS[
        masterSector
      ],

      classified: true,

      source:
        "MASTER"
    };
  }


  const inferred =
    inferSectorFromName(
      name
    );


  if (
    inferred &&
    SECTORS[inferred]
  ) {

    return {
      ...SECTORS[
        inferred
      ],

      classified: true,

      source:
        "NAME_INFERENCE"
    };
  }


  return {

    id:
      "UNKNOWN",

    name:
      "미분류",

    classified:
      false,

    source:
      "UNKNOWN"
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

  if (
    !Array.isArray(stocks)
  ) {
    return [];
  }


  return stocks.map(
    classifyStock
  );
}


/* =========================================================
   GROUP
========================================================= */

function groupBySector(stocks) {

  const classified =
    classifyStocks(
      stocks
    );


  const groups = {};


  for (
    const stock
    of classified
  ) {

    const sectorId =
      stock.sectorId ||
      "UNKNOWN";


    if (
      !groups[
        sectorId
      ]
    ) {

      groups[
        sectorId
      ] = {

        id:
          sectorId,

        name:
          stock.sector ||
          "미분류",

        stocks:
          []
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
   STATS
========================================================= */

function getClassificationStats(stocks) {

  if (
    !Array.isArray(stocks)
  ) {

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


  for (
    const stock
    of stocks
  ) {

    const result =
      classifyStock(
        stock
      );


    if (
      !result.sectorClassified
    ) {

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
        coverage.toFixed(
          2
        )
      ),

    master,

    inferred
  };
}


/* =========================================================
   UNCLASSIFIED
========================================================= */

function getUnclassifiedStocks(stocks) {

  if (
    !Array.isArray(stocks)
  ) {
    return [];
  }


  return stocks.filter(
    stock => {

      const result =
        classifyStock(
          stock
        );


      return (
        !result
          .sectorClassified
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

  NAME_RULES,

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
