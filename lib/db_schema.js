module.exports = {
	'ComponentSecrets':{
		table: 'component_secrets',
		columns: {
			'ticket' : String,
			'ticket_updated_at' : Number,
			'access_token' : String,
			'access_token_updated_at' : Number,
			'access_token_expires_in' : Number,
			'preauthcode' : String,
			'preauthcode_updated_at' : Number,
			'preauthcode_expires_in' : Number
		}
	},
	'WxUserInfo':{
		table: 'wx_users_info',
		columns: {
			appid:String,
			access_token:String,
			access_token_updated_at:Date,
			access_token_expires_in:Date,
			refresh_token:String,
			nick_name:String,
			head_img:String,
			service_type_id:Number,
			verify_type_info:String,
			user_name:String,
			alias:String,
			wx_token:String
		}
	}
}
