var O         = require('O');
var xml2js    = require('xml2js');
var orm       = require('orm');
var Cryptor   = require('wechat-crypto');
var query     = require('./query');
var DB_SCHEMA = require('./db_schema');

const HOUR                  = 36e5;
const MINUTE                = 6e4;
const TICKET_VALID_DURATION = HOUR;

function ThirdpartyServer( component_appid , component_appsecret , token , encoding_aes_key , db_config , is_cluster){
	
	if( !component_appid ) throw '第三方appid不能为空';
	if( !component_appsecret ) throw '第三方appsecret不能为空';
	if( !token ) throw 'Token不能为空';
	if( !encoding_aes_key ) throw 'EncodingAESKey不能为空';
	if( !db_config ) throw '没数据库配置搞毛啊';

	var that = this;

	// wx config
	this.component_appsecret = component_appsecret;
	this.component_appid     = component_appid;
	this.token               = token;
	this.encoding_aes_key    = encoding_aes_key;

	// db related
	this.db_config           = db_config;
	this.read_db             = null;
	this.write_db            = null;
	this.models              = { read:{}, write:{} };

	// status
	this.ticket_ready        = false;
	this.db_ready            = false;

	// utils
	this.crypto              = new Cryptor( this.token , this.encoding_aes_key , this.component_appid );

	// init
	this.set_db( db_config , function(){
		is_cluster && that.check_ticket();
	});

	if( !is_cluster ){
		this.init_secrets();
	}

	// secrets
	this.ticket       = null;
	this.access_token = null;
	this.preauthcode  = null;

	// last fetch time
	this.last_fetch_at = {
		access_token : null,
		ticket       : null,
		preauthcode  : null
	};

	// fail count
	this.get_access_token_fail_count = 0;
	this.get_preauthcode_fail_count  = 0;

	this.is_cluster = is_cluster;

}

// 初始化数据库配置
ThirdpartyServer.prototype.set_db = function( config , callback ){

	var that = this;
	var read_db_ready = false , write_db_ready = false;

	function check_ready(){
		if( read_db_ready && write_db_ready ) {
			that.db_ready = true;
			typeof callback === 'function' && callback();
		}
	}
	
	orm.connect( config.write || config , function( err , db ){

		if(err) throw err;

		that.write_db = db;

		Object.keys( DB_SCHEMA ).forEach( function(klass){

			var schema = DB_SCHEMA[klass];

			that.models.write[klass] = that.write_db.define( schema.table , schema.columns , schema.options );

		});

		write_db_ready = true;

		check_ready();

	});

	orm.connect( config.read || config , function( err , db ){

		if(err) throw err;

		that.read_db = db;

		Object.keys( DB_SCHEMA ).forEach( function(klass){

			var schema = DB_SCHEMA[klass];

			that.models.read[klass] = that.read_db.define( schema.table , schema.columns , schema.options );

		});

		read_db_ready = true;

		check_ready();

	});

};

// 存储ticket
ThirdpartyServer.prototype.save_ticket = function(ticket_xml){

	var that = this;

	O.set(ticket_xml)
	 .then(xml2js.parseString)
	 .then(function(data){ return that.crypto.decrypt(data.xml.Encrypt[0]).message; })
	 .then(xml2js.parseString)
	 .then(function(result){
		that.ticket = result.xml.ComponentVerifyTicket[0];
		that.ticket_ready = true;
		var now = new Date().getTime();
		that.models.read.ComponentSecrets.find( {} , 1 , function( err , secret ){
			if( err ){
				return console.log('读取数据库失败，无法写入ticket，server重启前仍能正常运行，请尽快检查服务器配置');
			}

			if( !secret.length ){
				return that.models.read.ComponentSecrets.create({
					ticket : that.ticket,
					ticket_updated_at : now
				}, function(err){
					if( err ){
						return console.log('写入数据库失败，无法写入ticket，server重启前仍能正常运行，请尽快检查服务器配置');
					}
				});
			}

			secret[0].ticket = that.ticket;
			secret[0].ticket_updated_at = now;

			secret[0].save( function( err ){
				if( err ){
					return console.log('写入数据库失败，无法写入ticket，server重启前仍能正常运行，请尽快检查服务器配置');
				}
			});
		});
	 });

};

ThirdpartyServer.prototype.start = function(){
	
	if( this.is_cluster ) return;

	var that = this;

	// 检查数据库
	if( !this.db_ready ) {
		console.log( 'db not ready. start over in 5 seconds' );
		return setTimeout( function(){
			that.start();
		}, 5e3 );
	};

	// 检查ticket
	if( !this.ticket_ready ){
		console.log( 'ticket not ready. start again in 5 seconds ' );
		return setTimeout( function(){
			that.start();
		}, 5e3 );
	}

	// 启动脚本刷新secrets
	this.refresh_secrets();

};

ThirdpartyServer.prototype.check_ticket = function(){

	var that = this;

	that.models.read.ComponentSecrets.find( {} , 1 , function( err , secret ){

		if( err ) throw err;

			console.log(JSON.stringify(secret[0]),new Date().getTime() - secret[0].ticket_updated_at);

		// ticket 每一个小时变化一次
		if( secret[0].ticket && new Date().getTime() - secret[0].ticket_updated_at < TICKET_VALID_DURATION ){
			that.ticket = secret[0].ticket;
			that.ticket_ready = true;
		}

	});

};

ThirdpartyServer.prototype.refresh_secrets = function(){
	
	var that = this;

	that.models.read.ComponentSecrets.find( {} , 1 , function( err , secret ){
		
		if( err ) throw err;

		// 如果数据库里没有access_token和preauthcode，马上去获取
		if( !secret[0].access_token ){
			return that.get_access_token( function(){
				that.refresh_secrets();
			});
		}
		
		// 在access_token和preauthcode失效前一分钟重新获取
		if( secret[0].access_token ){
			
			that.last_fetch_at.access_token = secret[0].access_token_updated_at;

			if( !that.last_fetch_at.access_token ){
				return that.get_access_token( function(){
					that.refresh_secrets();
				})
			}

			that.access_token = secret[0].access_token;

			setTimeout(
				function(){ that.get_access_token(); },
				Math.max( that.last_fetch_at.access_token + secret[0].access_token_expires_in*1000 - new Date() - MINUTE )
			);

		}

		if( !secret[0].preauthcode ){
			that.get_preauthcode();
		}

		if( secret[0].preauthcode ){
		
			that.last_fetch_at.preauthcode = secret[0].preauthcode_updated_at;

			if( !that.last_fetch_at.preauthcode ){
				return that.get_preauthcode();
			}

			that.preauthcode = secret[0].preauthcode;

			setTimeout(
				function(){ that.get_preauthcode(); },
				Math.max( that.last_fetch_at.preauthcode + secret[0].preauthcode_expires_in*1000 - new Date() - MINUTE)
			);

		}

	});

};

ThirdpartyServer.prototype.get_access_token = function( callback ){

	var that = this;

	query.post(
		'https://api.weixin.qq.com/cgi-bin/component/api_component_token',
		{
			"component_appid"         : that.component_appid ,
			"component_appsecret"     : that.component_appsecret, 
			"component_verify_ticket" : that.ticket
		},
		function( err , data ){
			if( err ){
				that.get_access_token_fail_count++;
				if( that.get_access_token_fail_count >= 5 ){
					console.log(
						'刷新第三方access_token连续失败5次，为避免被微信封杀，停止尝试，可能有以下原因：\n'+
						'1.你服务器断网了\n'+
						'2.微信服务器瓦了\n'+
						'3.你的第三方平台账号被和谐了\n'+
						'4.你的授权回调接口歇菜了\n'+
						'为避免影响业务运行，请赶快排查，错误信息：'+err
					);
				}else{
					console.log( '刷新第三方access_token失败，尝试重新获取，错误信息：' , err );
				}
				setTimeout(function(){
					that.get_access_token();
				},3000);
				return ;
			}

			var now = new Date().getTime();

			data = JSON.parse(data);

			if(data.errcode) {
				that.get_access_token_fail_count++;
				if( that.get_access_token_fail_count >= 5 ){
					return console.log( '获取access_token连续失败5次，为避免被微信封杀，停止尝试，为避免影响业务运行，请赶快排查，错误信息：'+JSON.stringify(data));
				}else{
					console.log( '获取第三方access_token失败，错误信息：' + data + ',5秒钟后重试');
					setTimeout(function(){
						that.get_access_token();
					},5000);
				}
			}

			that.get_access_token_fail_count = 0;
			that.access_token = data.component_access_token;
			that.last_fetch_at.access_token = now;

			that.models.read.ComponentSecrets.find( {} , 1 , function( err , secret ){
				secret[0].access_token = data.component_access_token;
				secret[0].access_token_updated_at = now;
				secret[0].access_token_expires_in = data.expires_in;
				secret[0].save( function( err ){
					if( err ){
						console.log('尝试将access_token写入数据库失败,最新的数据已写入内存，在server重启前仍能正常运行，请尽快检查数据库配置');
					}
				});
			});
			typeof callback === 'function' && callback();
			var timer = data.expires_in - 60;
			console.log('获取access_token成功，' + timer + '秒后重新获取');
			setTimeout( function(){
				that.get_access_token()
			}, timer*1000);
		}
	);

};

ThirdpartyServer.prototype.get_preauthcode = function(){

	var that = this;
	
	query.post(
		'https://api.weixin.qq.com/cgi-bin/component/api_create_preauthcode?component_access_token=' + that.access_token,
		{
			"component_appid" : that.component_appid
		},
		function( err , data ){

			if( err ){
				that.get_preauthcode_fail_count++;
				if( that.get_preauthcode_fail_count >= 5 ){
					return console.log(
						'刷新preauthcode异常，可能有以下原因：\n'+
						'1.你服务器断网了\n'+
						'2.微信服务器瓦了\n'+
						'3.你的第三方平台账号被和谐了\n'+
						'4.你的获取ticket接口歇菜了\n'+
						'为避免影响业务运行，请赶快排查'
					);
				}else{
					console.log( '刷新preauthcode失败，尝试重新获取，错误信息：' , err );
				}
				return that.get_preauthcode();
			}

			var now = new Date().getTime();

			data = JSON.parse(data);
			if(data.errcode) return console.log(data);

			that.get_preauthcode_fail_count = 0;
			that.preauthcode = data.pre_auth_code;
			that.last_fetch_at.preauthcode = now;

			that.models.read.ComponentSecrets.find( {} , 1 , function( err , secret ){

				secret[0].preauthcode            = data.pre_auth_code;
				secret[0].preauthcode_updated_at = now;
				secret[0].preauthcode_expires_in = data.expires_in;

				secret[0].save( function( err ){
					err && console.log('尝试将preauthcode写入数据库失败,最新的数据已写入内存，在server重启前仍能正常运行，请尽快检查数据库配置');
				});

			});
			
			var timer = data.expires_in - 60;

			console.log('获取preauthcode成功，'+timer+'秒后重新获取');

			setTimeout(function(){
				that.get_preauthcode();
			}, timer*1000);
		}
	);

};


module.exports = ThirdpartyServer;
