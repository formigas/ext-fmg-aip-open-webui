#! /bin/bash

set -e

REGISTRY_NAME=acrfmgaiprodgermanywestcentral
ARCHITECTURE=amd64
PLATFORM=linux/$ARCHITECTURE
REPOSITORY_NAME=aip/open-webui
THEMES_PATH=./themes/custom_themes.json

## You need to be logged in to Azure to deploy to the registry
# az login

az acr login --name $REGISTRY_NAME

if [ -z "$1" ]; then
    echo "No version passed, as the first argument. Do it like e.g. ./build-push-docker-image.sh 1.0.0"
    exit 1
else
    VERSION=$1
fi

docker buildx build \
  --build-arg ARG_PUBLIC_CUSTOM_THEMES_JSON_RELATIVE_TO_ROOT_PATH=$THEMES_PATH \
  -t $REGISTRY_NAME:$VERSION-$ARCHITECTURE \
  --load \
  --platform $PLATFORM \
  .

echo "Docker image $REGISTRY_NAME:$VERSION-$ARCHITECTURE built successfully"

docker tag $REGISTRY_NAME:$VERSION-$ARCHITECTURE $REGISTRY_NAME.azurecr.io/$REPOSITORY_NAME:$VERSION-$ARCHITECTURE
docker tag $REGISTRY_NAME:$VERSION-$ARCHITECTURE $REGISTRY_NAME.azurecr.io/$REPOSITORY_NAME:latest-$ARCHITECTURE

docker push $REGISTRY_NAME.azurecr.io/$REPOSITORY_NAME:$VERSION-$ARCHITECTURE
docker push $REGISTRY_NAME.azurecr.io/$REPOSITORY_NAME:latest-$ARCHITECTURE

echo "Docker image $REGISTRY_NAME.azurecr.io/$REPOSITORY_NAME:$VERSION-$ARCHITECTURE build and pushed"

