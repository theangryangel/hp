package models


import (
	"database/sql"

	_ "github.com/mattn/go-sqlite3"
)

type User struct {
	ID   int64    `json:"id"`
	Name string `json:"name"`
	Points int  `json:"points"`
}

type UserCollection struct {
	Users []User `json:"items"`
}

func GetUsers(db *sql.DB) UserCollection {
	sql := "SELECT users.id, users.name, SUM(COALESCE(points.quantity, 0)) as points FROM users LEFT JOIN points ON points.user_id = users.id GROUP BY users.id, users.name"
	rows, err := db.Query(sql)
	// Exit if the SQL doesn't work for some reason
	if err != nil {
		panic(err)
	}
	// make sure to cleanup when the program exits
	defer rows.Close()

	result := UserCollection{}
	for rows.Next() {
		task := User{}
		err2 := rows.Scan(&task.ID, &task.Name, &task.Points)
		// Exit if we get an error
		if err2 != nil {
			panic(err2)
		}
		result.Users = append(result.Users, task)
	}
	return result
}

func CreateUser(db *sql.DB, user User) User {
	stmt, err := db.Prepare("INSERT INTO users(name) VALUES(?)")
	// Exit if we get an error
	if err != nil {
		panic(err)
	}
	// Make sure to cleanup after the program exits
	defer stmt.Close()

	// Replace the '?' in our prepared statement with 'name'
	result, err2 := stmt.Exec(user.Name)
	// Exit if we get an error
	if err2 != nil {
		panic(err2)
	}

	id, err := result.LastInsertId()
	if err != nil {
		panic(err)
	}
	user.ID = id
	return user
}

func GetUser(db *sql.DB, user User) User {
	sql := "SELECT users.name, SUM(COALESCE(points.quantity, 0)) as points FROM users LEFT JOIN points ON points.user_id = users.id WHERE users.id = ? GROUP BY users.id, users.name LIMIT 1"
  err := db.QueryRow(sql, user.ID).Scan(&user.Name, &user.Points)
	if err != nil {
		panic(err)
	}

	return user
}

func DeleteUser(db *sql.DB, user User) User {
	sql := "DELETE FROM users WHERE id = ? CASCADE"
	_, err := db.Exec(sql, user.ID)
	if err != nil {
		panic(err)
	}

	// TODO should probably check the rows affected

	return user
}

func RewardUser(db *sql.DB, user User, quantity int64) User {
	stmt, err := db.Prepare("INSERT INTO points(user_id, quantity) VALUES(?, ?)")
	// Exit if we get an error
	if err != nil {
		panic(err)
	}
	// Make sure to cleanup after the program exits
	defer stmt.Close()

	_, err2 := stmt.Exec(user.ID, quantity)
	// Exit if we get an error
	if err2 != nil {
		panic(err2)
	}

	return GetUser(db, user)
}
