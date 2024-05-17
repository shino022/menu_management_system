import { APIGatewayProxyResult, APIGatewayEvent } from "aws-lambda";
import { DynamoDBClient, ReturnValue } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import axios from "axios";

const USERS_TABLE = process.env.USERS_TABLE || "";
const dynamoDb = new DynamoDBClient({});
const documentClient = DynamoDBDocumentClient.from(dynamoDb);

enum MenuRoutes {
  CREATE_MENU = "POST /menus",
  GET_MENUS = "GET /menus",
  UPDATE_MENU = "PUT /menus/{menuid}",
}

export const handler = (event: APIGatewayEvent): Promise<APIGatewayProxyResult> => {
  let response: Promise<APIGatewayProxyResult>;

  switch (`${event.httpMethod} ${event.resource}`) {
    case MenuRoutes.CREATE_MENU:
      response = createMenu(event);
      break;
    case MenuRoutes.GET_MENUS:
      response = getMenus(event);
      break;
    case MenuRoutes.UPDATE_MENU:
      response = updateMenu(event);
      break;
    default:
      response = Promise.resolve({
        statusCode: 400,
        headers: { ...defaultHeaders },
        body: JSON.stringify({
          message: "Unsupported route",
        }),
      });
      break;
  }

  return response.catch((error) => {
    console.log(error);
    return {
      statusCode: 400,
      headers: { ...defaultHeaders },
      body: JSON.stringify({ Error: error }),
    };
  });
};

const defaultHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

// Create a menu for a user
const createMenu = async (event: APIGatewayEvent): Promise<APIGatewayProxyResult> => {
  const userid = event.requestContext.authorizer?.principalId || {};
  const { menu } = JSON.parse(event.body || "{}");
  const timestamp = new Date().toISOString();
  const urlFriendlyIndex = timestamp.replace(/[:.]/g, "-");

  const params = {
    TableName: USERS_TABLE,
    Item: {
      userid: userid,
      sk: `MENU#${urlFriendlyIndex}`,
      timestamp,
      menu,
    },
  };
  return documentClient.send(new PutCommand(params)).then(() => {
    return {
      statusCode: 201,
      headers: { ...defaultHeaders },
      body: JSON.stringify({ menuid: urlFriendlyIndex, menu }),
    };
  });
};

// todo: error handling when there's no data by the user
const getMenus = async (event: APIGatewayEvent): Promise<APIGatewayProxyResult> => {
  const userid = event.requestContext.authorizer?.principalId || {};
  const params = {
    TableName: USERS_TABLE,
    KeyConditionExpression: "#userid = :useridVal and begins_with(#sk, :prefix)",
    ExpressionAttributeNames: {
      "#userid": "userid",
      "#sk": "sk",
    },
    ExpressionAttributeValues: {
      ":useridVal": userid,
      ":prefix": "MENU#",
    },
  };
  const data = await documentClient.send(new QueryCommand(params));
  const items = data.Items || [];
  // extract the menuid and menu from the data
  const response = {
    menus: items.map(({menu, sk}) => {
      return {
        menuid: sk.replace("MENU#", ""),
        menu: menu,
      };
    }),
  };
  return {
    statusCode: 200,
    headers: { ...defaultHeaders },
    body: JSON.stringify(response),
  };
};

const updateMenu = async (event: APIGatewayEvent): Promise<APIGatewayProxyResult> => {
  const userid = event.requestContext.authorizer?.principalId || {};
  const { menuid } = event.pathParameters || {};
  const body = JSON.parse(event.body || "{}");
  body["userid"] = userid;
  body["timestamp"] = new Date().toISOString();
  body["sk"] = `MENU#${menuid}`;

  const param = {
    TableName: USERS_TABLE,
    Key: {
      userid: userid,
      sk: `MENU#${menuid}`,
    },
    UpdateExpression: "set menu = :menu",
    ExpressionAttributeValues: {
      ":menu": body.menu,
    },
    ReturnValues: "ALL_NEW" as ReturnValue,
  };

  //fetch repos info from dynamodb
  const data = await documentClient.send(
    new GetCommand({
      TableName: USERS_TABLE,
      Key: {
        userid: userid,
        sk: `MENU#${menuid}`,
      },
    })
  );
  const { owner, repo, path, token } = data.Item as any;
  // console.log("@Menu: ", owner, repo, path);
  const fileData = await getFileContent(owner, repo, path, token);
  const result = await updateFileContent(owner, repo, path, token, { menu: body.menu }, fileData.sha);
  // console.log("@Repo Info: ", fileData);
  // console.log("@Repo After Updated: ", result);

  return documentClient
    .send(new UpdateCommand(param))
    .then(() => {
      return {
        statusCode: 200,
        headers: { ...defaultHeaders },
        body: JSON.stringify({ menuid, menu: body.menu }),
      };
    })
    .catch((error: any) => {
      console.log(error);
      return {
        statusCode: 400,
        headers: { ...defaultHeaders },
        body: JSON.stringify({ Error: error }),
      };
    });
};

const getFileContent = async (owner: any, repo: any, path: any, token: any) => {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const response = await axios.get(url, {
    headers: {
      Authorization: token,
      Accept: "application/vnd.github.v3+json",
    },
  });
  return response.data;
};

const updateFileContent = async (owner: any, repo: any, path: any, token:any, content: any, sha: any) => {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const payload = {
    message: "Update JSON file",
    content: Buffer.from(JSON.stringify(content, null, 2)).toString("base64"),
    sha: sha,
    branch: "main", // Specify the branch you want to commit to
  };
  console.log(url);
  const response = await axios.put(url, payload, {
    headers: {
      Authorization: token,
      Accept: "application/vnd.github.v3+json",
    },
  });
  return response.data;
};
