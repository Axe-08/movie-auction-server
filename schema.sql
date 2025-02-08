-- Crew members table
CREATE TABLE crew_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    rating INTEGER NOT NULL,
    base_price INTEGER NOT NULL,
    status TEXT DEFAULT 'available'
);

-- Production houses table
CREATE TABLE production_houses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    budget INTEGER NOT NULL,
    access_code TEXT UNIQUE NOT NULL
);

-- Purchased crew table
CREATE TABLE purchased_crew (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    production_house_id INTEGER,
    crew_member_id INTEGER,
    purchase_price INTEGER NOT NULL,
    FOREIGN KEY(production_house_id) REFERENCES production_houses(id),
    FOREIGN KEY(crew_member_id) REFERENCES crew_members(id)
);