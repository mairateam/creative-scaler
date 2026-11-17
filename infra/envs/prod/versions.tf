terraform {
  required_version = ">= 1.9"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "8.9.0"
    }
    # Firebase (projekt, Hosting site, vlastní doména) je zatím jen v google-beta.
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "8.9.0"
    }
  }
}
