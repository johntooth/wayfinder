variable "name" { type = string }

variable "access_log_bucket" { type = string }

variable "noncurrent_version_days" {
  type    = number
  default = 30
}

variable "tags" {
  type    = map(string)
  default = {}
}
