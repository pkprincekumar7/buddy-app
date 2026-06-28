{
  "widgets": [
    {
      "type": "metric",
      "x": 0,
      "y": 0,
      "width": 8,
      "height": 6,
      "properties": {
        "title": "API CPU Utilization",
        "metrics": [
          ["AWS/ECS", "CPUUtilization", "ClusterName", "${cluster_name}", "ServiceName", "${api_service_name}"]
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
        "title": "API Memory Utilization",
        "metrics": [
          ["AWS/ECS", "MemoryUtilization", "ClusterName", "${cluster_name}", "ServiceName", "${api_service_name}"]
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
          ["AWS/ElastiCache", "CurrConnections", "ReplicationGroupId", "${redis_replication_group}"]
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
          ["AWS/ElastiCache", "NetworkBytesIn", "ReplicationGroupId", "${redis_replication_group}"]
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
          ["Buddy360/Worker", "PendingJobCount"]
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
    }
  ]
}
