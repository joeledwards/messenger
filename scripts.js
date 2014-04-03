$(document).ready(function ()
{
    console.log("jQuery is ready");

    var socket = io.connect('http://localhost');

    socket.on('message', function (data)
    {
        console.log("Received message: ", data);
    });
});
