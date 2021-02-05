package handlers

import (
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/theangryangel/horse-poo/models"
)

func (h *Handler) GetUsers(c echo.Context) (err error) {
	return c.JSON(http.StatusOK, models.GetUsers(h.DB))
}

func (h *Handler) CreateUser(c echo.Context) (err error) {
	var user models.User
	c.Bind(&user)

	return c.JSON(http.StatusOK, models.CreateUser(h.DB, user))
}

func (h *Handler) GetUser(c echo.Context) (err error) {
	var user models.User

	user.ID, err = strconv.ParseInt(c.Param("user"), 10, 64)
	if err != nil {
		panic(err)
	}

	return c.JSON(http.StatusOK, models.GetUser(h.DB, user))
}

func (h *Handler) DeleteUser(c echo.Context) (err error) {
	var user models.User

	user.ID, err = strconv.ParseInt(c.Param("user"), 10, 64)
	if err != nil {
		panic(err)
	}

	return c.JSON(http.StatusOK, models.DeleteUser(h.DB, user))
}

func (h *Handler) RewardUser(c echo.Context) (err error) {
	var user models.User

	user.ID, err = strconv.ParseInt(c.Param("user"), 10, 64)
	if err != nil {
		panic(err)
	}

	var quantity int64

	quantity, err = strconv.ParseInt(c.QueryParam("quantity"), 10, 64)
	if err != nil {
		quantity = 1
	}

	return c.JSON(http.StatusOK, models.RewardUser(h.DB, user, quantity))
}
