-- Перед запуском выберите нужную базу данных (USE имя_базы;)
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS sessions, writeoffs, inventory_items, inventory_checks, audit_log, repairs, assignments, assets, users, rooms, teachers, categories;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE teachers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  subject VARCHAR(100),
  phone VARCHAR(30)
);
CREATE TABLE categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE
);
CREATE TABLE rooms (
  id INT AUTO_INCREMENT PRIMARY KEY,
  number VARCHAR(20) NOT NULL,
  name VARCHAR(100) NOT NULL,
  building VARCHAR(50),
  floor INT DEFAULT 1,
  teacher_id INT NULL,
  FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL
);
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  login VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  role ENUM('admin','technician','teacher') NOT NULL,
  teacher_id INT NULL,
  FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL
);
CREATE TABLE assets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  inventory_no VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  category_id INT NOT NULL,
  room_id INT NOT NULL,
  cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  status ENUM('в эксплуатации','на складе','на ремонте','неисправно','списано') NOT NULL DEFAULT 'в эксплуатации',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id),
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);
CREATE TABLE assignments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  asset_id INT NOT NULL,
  room_id INT NOT NULL,
  date DATE NOT NULL,
  reason VARCHAR(100),
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);
CREATE TABLE repairs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  asset_id INT NOT NULL,
  description TEXT NOT NULL,
  priority ENUM('низкий','средний','высокий') NOT NULL DEFAULT 'средний',
  status ENUM('новая','принята','в работе','ожидает запчасти','выполнена','отклонена') NOT NULL DEFAULT 'новая',
  created_by VARCHAR(100),
  date DATE NOT NULL,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);
CREATE TABLE audit_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_name VARCHAR(100),
  action VARCHAR(50),
  details VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE inventory_checks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  room_id INT NOT NULL,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP NULL,
  created_by VARCHAR(100),
  status ENUM('открыта','закрыта') NOT NULL DEFAULT 'открыта',
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);
CREATE TABLE inventory_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  check_id INT NOT NULL,
  asset_id INT NOT NULL,
  result ENUM('не проверено','найдено','не найдено','повреждено') NOT NULL DEFAULT 'не проверено',
  FOREIGN KEY (check_id) REFERENCES inventory_checks(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);
CREATE TABLE writeoffs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  asset_id INT NOT NULL,
  reason VARCHAR(255) NOT NULL,
  date DATE NOT NULL,
  created_by VARCHAR(100),
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);
CREATE TABLE sessions (
  sid VARCHAR(128) PRIMARY KEY,
  data TEXT NOT NULL,
  expires BIGINT NOT NULL
);
