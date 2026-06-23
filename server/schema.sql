-- onban MySQL schema
CREATE TABLE IF NOT EXISTS daily_menus (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  date     DATE         NOT NULL,
  name     VARCHAR(200) NOT NULL,
  cat      VARCHAR(50)  DEFAULT '기타',
  price    DECIMAL(6,1) DEFAULT 0,
  stock    INT          DEFAULT 0,
  child    TINYINT(1)   DEFAULT 0,
  img_url  VARCHAR(1000) DEFAULT '',
  INDEX idx_date (date)
);

CREATE TABLE IF NOT EXISTS menus (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(200) UNIQUE NOT NULL,
  cat        VARCHAR(50)  DEFAULT '기타',
  price      DECIMAL(6,1) DEFAULT 0,
  stock      INT          DEFAULT 0,
  child      TINYINT(1)   DEFAULT 0,
  img_url    VARCHAR(1000) DEFAULT '',
  count      INT          DEFAULT 0,
  updated_at BIGINT       DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id                  VARCHAR(100) PRIMARY KEY,
  date                DATE,
  time                VARCHAR(20),
  name                VARCHAR(100),
  phone               VARCHAR(30),
  addr                VARCHAR(500),
  memo                VARCHAR(1000),
  items               JSON,
  total               INT          DEFAULT 0,
  status              VARCHAR(30)  DEFAULT 'pending',
  admin_reply         TEXT,
  reply_at            DATETIME,
  additional_request  TEXT,
  is_reorder          TINYINT(1)   DEFAULT 0,
  created_at          DATETIME     DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  date       DATE,
  name       VARCHAR(100),
  phone      VARCHAR(30),
  addr       VARCHAR(500),
  memo       VARCHAR(1000),
  created_at DATETIME DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  k VARCHAR(100) PRIMARY KEY,
  v TEXT
);

CREATE TABLE IF NOT EXISTS access_log (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  created_at DATETIME DEFAULT NOW(),
  ip         VARCHAR(100),
  referrer   VARCHAR(500),
  page       VARCHAR(100)
);
