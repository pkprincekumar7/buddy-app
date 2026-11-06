schedule_timezone         = "Asia/Kolkata"
start_schedule_expression = "cron(0 15 * * ? *)" # 03:00 PM IST
stop_schedule_expression  = "cron(0 22 * * ? *)" # 10:00 PM IST
# Email OPS_EMAIL when a scheduled dispatch fails (alarms.tf, SCH-01).
enable_alarms = true
