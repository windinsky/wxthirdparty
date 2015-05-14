var http  = require('http');
var https = require('https');
var url   = require('url');
var querystring = require('querystring');

var query = exports.query = function( _url , method , data , callback ){

	_url = url.parse(_url);
	
	var protocol = _url.protocol === 'https:' ? https : http;
	var resData = '';

	var options = {
		hostname : _url.host,
		port     : _url.port || (_url.protocol == 'https:' ? 443 : 80),
		path     : _url.path,
		method   : method
	};

	if( method.toLowerCase() === 'post' ){

		data = JSON.stringify(data);

		options.headers = {
			'Content-Length': data.length
		};
	}
	
	var req = protocol.request( options , function( res ) {
		res.on( 'data' , function( d ){
			resData += d;
		});
		res.on( 'end' , function(){
			return typeof callback === 'function' && callback( undefined , resData.toString() );
		})
	});

	req.on( 'error' , function( err ){
		return typeof callback === 'function' && callback( err );
	});


	if( method.toLowerCase() === 'post' ){
		
		req.write(data);

	}

	req.end();

};

exports.get = function( _url , callback ){
	query( _url , 'get' , '' , callback );
};


exports.post = function( _url , data , callback ){
	query( _url , 'post' , data , callback );
}
