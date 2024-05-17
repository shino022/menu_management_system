## How to test lamda functions locally
### pre req 
- cdk, sam and docker installed
- synthisize by `cdk synth` to get your function ready to test
- find your functions `logical id` in `cdkout\MenuManagementSystemStack.template.json`
- setup `env.json` if needed
  ```
  {
    "<function logical id>": {
      "<env var name>": "<env var value>"
    }
  }
  ```
- setup mocked event if needed

### run the test
- sam local invoke `logical id` -e `path to event.json` -n `path to env.json` -t `path to template.json`