$(document).ready(function()
{
	console.log("jQuery is ready");

	var socket = io.connect('http://www.ed-craft.com:8888/');
    var client_id;

    socket.on('welcome', function(data)
    {
        client_id = data.client_id;
        console.log("I am client " + data.client_id);
        $('div.client span').append('' + data.client_id);
    });

	socket.on('message', function(data)
	{
		console.log("Received message: ", data);

        var classify = data.from == client_id ? "sent" : "received";
        var who = data.from == client_id ? "me" : data.from;

		$('#display').append('<div class="message ' + classify + '"><span class="id">'
            + who +': </span>'
            + Base64.decode(data.body) + '</div>');

        $("body").scrollTop($(document).height());
	});

	$('#msg').keypress(function(e)
	{
		if (e.which == 13)
		{
			var message = $('#msg').val();
			$('#msg').val('');
			console.log("message: " + message);

			socket.emit('broadcast', {
				encoding : "base64",
				body : Base64.encode(message)
			});

			return false;
		}
	});

    $('#msg').focus();
});
