variable "project_name" {
  description = "Resource name prefix shared by every environment"
  type        = string
  default     = "wayfinder"
}

variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the shared VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "base_domain" {
  description = "Environments are exposed as <env>.<base_domain> (ADR-034 Decision 3)"
  type        = string
}

variable "certificate_arn" {
  description = "ACM certificate covering *.<base_domain>"
  type        = string
}

variable "db_instance_class" {
  description = "Instance class of the shared RDS server"
  type        = string
  default     = "db.t4g.small"
}

variable "db_allocated_storage" {
  description = "Shared RDS storage (GiB)"
  type        = number
  default     = 20
}

variable "db_skip_final_snapshot" {
  description = "Skip the final snapshot on destroy (leave false outside dev accounts)"
  type        = bool
  default     = false
}
