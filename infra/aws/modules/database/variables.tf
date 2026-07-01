variable "project_name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "instance_class" {
  type = string
}

variable "allocated_storage" {
  type = number
}

variable "skip_final_snapshot" {
  type = bool
}

variable "client_security_group_ids" {
  description = "Security groups allowed to reach Postgres"
  type        = list(string)
}
