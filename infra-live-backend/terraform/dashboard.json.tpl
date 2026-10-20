{
  "widgets": [
    {
      "type": "metric",
      "x": 0,
      "y": 0,
      "width": 8,
      "height": 6,
      "properties": {
        "title": "API, Auth & Admin CPU Utilization",
        "metrics": [
          ["AWS/ECS", "CPUUtilization", "ClusterName", "${cluster_name}", "ServiceName", "${api_service_name}", { "label": "API" }],
          ["AWS/ECS", "CPUUtilization", "ClusterName", "${cluster_name}", "ServiceName", "${auth_service_name}", { "label": "Auth" }],
          ["AWS/ECS", "CPUUtilization", "ClusterName", "${cluster_name}", "ServiceName", "${admin_service_name}", { "label": "Admin" }]
        ],
        "period": 300,
        "stat": "Average",
        "region": "${region}",
        "view": "timeSeries",
        "annotations": {
          "horizontal": [{ "label": "Alarm threshold", "value": 85 }]
        }
      }
    },
    {
      "type": "metric",
      "x": 8,
      "y": 0,
      "width": 8,
      "height": 6,
      "properties": {
        "title": "API, Auth & Admin Memory Utilization",
        "metrics": [
          ["AWS/ECS", "MemoryUtilization", "ClusterName", "${cluster_name}", "ServiceName", "${api_service_name}", { "label": "API" }],
          ["AWS/ECS", "MemoryUtilization", "ClusterName", "${cluster_name}", "ServiceName", "${auth_service_name}", { "label": "Auth" }],
          ["AWS/ECS", "MemoryUtilization", "ClusterName", "${cluster_name}", "ServiceName", "${admin_service_name}", { "label": "Admin" }]
        ],
        "period": 300,
        "stat": "Average",
        "region": "${region}",
        "view": "timeSeries",
        "annotations": {
          "horizontal": [{ "label": "Alarm threshold", "value": 85 }]
        }
      }
    },
    {
      "type": "metric",
      "x": 16,
      "y": 0,
      "width": 8,
      "height": 6,
      "properties": {
        "title": "Worker CPU Utilization",
        "metrics": [
          ["AWS/ECS", "CPUUtilization", "ClusterName", "${cluster_name}", "ServiceName", "${worker_service_name}"]
        ],
        "period": 300,
        "stat": "Average",
        "region": "${region}",
        "view": "timeSeries",
        "annotations": {
          "horizontal": [{ "label": "Alarm threshold", "value": 85 }]
        }
      }
    },
    {
      "type": "metric",
      "x": 0,
      "y": 6,
      "width": 8,
      "height": 6,
      "properties": {
        "title": "ALB Request Count",
        "metrics": [
          ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", "${alb_arn_suffix}"]
        ],
        "period": 300,
        "stat": "Sum",
        "region": "${region}",
        "view": "timeSeries"
      }
    },
    {
      "type": "metric",
      "x": 8,
      "y": 6,
      "width": 8,
      "height": 6,
      "properties": {
        "title": "ALB 5XX Errors",
        "metrics": [
          ["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", "LoadBalancer", "${alb_arn_suffix}"]
        ],
        "period": 300,
        "stat": "Sum",
        "region": "${region}",
        "view": "timeSeries"
      }
    },
    {
      "type": "metric",
      "x": 16,
      "y": 6,
      "width": 8,
      "height": 6,
      "properties": {
        "title": "Redis Current Connections",
        "metrics": [
          %{ for i, id in redis_member_ids ~}
          ["AWS/ElastiCache", "CurrConnections", "CacheClusterId", "${id}"]${i < length(redis_member_ids) - 1 ? "," : ""}
          %{ endfor ~}
        ],
        "period": 300,
        "stat": "Average",
        "region": "${region}",
        "view": "timeSeries"
      }
    },
    {
      "type": "metric",
      "x": 0,
      "y": 12,
      "width": 8,
      "height": 6,
      "properties": {
        "title": "Redis Network Bytes In",
        "metrics": [
          %{ for i, id in redis_member_ids ~}
          ["AWS/ElastiCache", "NetworkBytesIn", "CacheClusterId", "${id}"]${i < length(redis_member_ids) - 1 ? "," : ""}
          %{ endfor ~}
        ],
        "period": 300,
        "stat": "Average",
        "region": "${region}",
        "view": "timeSeries"
      }
    },
    {
      "type": "metric",
      "x": 8,
      "y": 12,
      "width": 8,
      "height": 6,
      "properties": {
        "title": "Worker Pending Job Count",
        "metrics": [
          ["Superpower/Worker", "PendingJobCount", "Environment", "${environment}"]
        ],
        "period": 300,
        "stat": "Average",
        "region": "${region}",
        "view": "timeSeries",
        "annotations": {
          "horizontal": [
            { "label": "Scale-out threshold", "value": 50 },
            { "label": "Ops alert threshold", "value": 100 }
          ]
        }
      }
    },
    {
      "type": "metric",
      "x": 16,
      "y": 12,
      "width": 8,
      "height": 6,
      "properties": {
        "title": "ALB Requests per Target",
        "metrics": [
          ["AWS/ApplicationELB", "RequestCountPerTarget", "TargetGroup", "${tg_arn_suffix}", "LoadBalancer", "${alb_arn_suffix}", { "label": "API" }],
          ["AWS/ApplicationELB", "RequestCountPerTarget", "TargetGroup", "${auth_tg_arn_suffix}", "LoadBalancer", "${alb_arn_suffix}", { "label": "Auth" }],
          ["AWS/ApplicationELB", "RequestCountPerTarget", "TargetGroup", "${admin_tg_arn_suffix}", "LoadBalancer", "${alb_arn_suffix}", { "label": "Admin" }]
        ],
        "period": 60,
        "stat": "Sum",
        "region": "${region}",
        "view": "timeSeries",
        "annotations": {
          "horizontal": [{ "label": "Autoscaling target", "value": 1000 }]
        }
      }
    }
  ]
}
