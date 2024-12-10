// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

interface ILayerServiceManager {

    struct LayerTask {
        string layerAVSID;
        bytes32 data;
    }
    event LayerTaskValidated(address indexed operator, LayerTask task);
}
