package socketapi

import (
	"github.com/yeseolee/janggi/api-server/internal/application"
	socketio "github.com/zishang520/socket.io/servers/socket/v3"
)

func NewServer(app *application.Service) *socketio.Server {
	app.SetupSocketServer()
	return app.SocketServer()
}
