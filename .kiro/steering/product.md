# Product Context

This repo contains the official collection of SpiraApps built by Inflectra for the Spira platform (SpiraTest, SpiraTeam, SpiraPlan).

## What SpiraApps Are
SpiraApps are browser-based plugins that extend Spira's UI. They run client-side inside Spira pages, use the spiraAppManager helper class for API calls and UI interactions, and are packaged as .spiraapp bundles uploaded by system admins.

## Who Uses Them
- End users interact with SpiraApp features (menus, widgets, columns) inside Spira
- Product admins configure per-product settings
- System admins install and configure SpiraApps at the instance level

## Business Context
- These are first-party SpiraApps maintained by Inflectra
- Quality and correctness matter — these ship to paying customers
- Each SpiraApp should be self-contained and independently deployable
- AI/GenAI integrations (AWS Bedrock, OpenAI, Azure OpenAI) are a key growth area
- SpiraAIConnect is the current unified AI SpiraApp consolidating older per-provider apps
