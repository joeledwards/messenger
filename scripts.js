$(document).ready(function()
{
	console.log("jQuery is ready");

	var socket = io.connect('http://localhost:8888/');

	socket.on('message', function(data)
	{
		console.log("Received message: ", data);
		
		$('#display').val($('#display').val() + "\n" + Base64.decode(data.body));
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
});
