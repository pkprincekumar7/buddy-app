schedule_enabled          = false
target_aws_regions        = ["ap-south-1"]
schedule_timezone         = "Asia/Kolkata"
start_schedule_expression = "cron(0 14 * * ? *)" # 02:00 PM IST
stop_schedule_expression  = "cron(0 22 * * ? *)" # 10:00 PM IST
