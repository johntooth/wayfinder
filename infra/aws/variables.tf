variable "project_name" {
  description = "Resource name prefix"
  type        = string
  default     = "wayfinder"
}

variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "enable_semchunk" {
  description = "Deploy the semantic-chunking sidecar and wire the web service to it (ADR-030)"
  type        = bool
  default     = false
}

variable "web_image_tag" {
  description = "Tag of the web image in the ECR repository created by this configuration"
  type        = string
  default     = "latest"
}

variable "semchunk_image_tag" {
  description = "Tag of the semchunk image in the ECR repository created by this configuration"
  type        = string
  default     = "latest"
}

variable "web_desired_count" {
  description = "Number of web tasks"
  type        = number
  default     = 1
}

variable "web_cpu" {
  description = "Fargate CPU units for the web task (1024 = 1 vCPU)"
  type        = number
  default     = 1024
}

variable "web_memory" {
  description = "Fargate memory (MiB) for the web task"
  type        = number
  default     = 2048
}

variable "semchunk_cpu" {
  description = "Fargate CPU units for the semchunk task"
  type        = number
  default     = 256
}

variable "semchunk_memory" {
  description = "Fargate memory (MiB) for the semchunk task"
  type        = number
  default     = 512
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.small"
}

variable "db_allocated_storage" {
  description = "RDS storage (GiB)"
  type        = number
  default     = 20
}

variable "db_skip_final_snapshot" {
  description = "Skip the final snapshot on destroy (leave false outside dev environments)"
  type        = bool
  default     = false
}

variable "certificate_arn" {
  description = "ACM certificate ARN for HTTPS on the ALB; empty serves plain HTTP (dev only)"
  type        = string
  default     = ""
}

variable "public_url" {
  description = "Public URL of the deployment (BETTER_AUTH_URL); empty derives http://<alb-dns>"
  type        = string
  default     = ""
}

variable "ai_default_provider" {
  description = "Default AI provider for the app (anthropic | openai | mistral | bedrock)"
  type        = string
  default     = "anthropic"
}
