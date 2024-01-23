// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.15;

import {AirdropRaffle} from "../../contracts/core/misc/AirdropRaffle.sol";
import {Utils} from "../../test/foundry/utils/Utils.sol";
import {ERC677} from "../../contracts/core/tokens/base/ERC677.sol";

contract AirdropRaffleScript is Utils {
    uint256 internal deployerPrivateKey;
    AirdropRaffle internal airdropRaffle;
    address public linkToken = 0xf97f4df75117a78c1A5a0DBb814Af92458539FB4; // arb
    address public vrfWrapper = 0x2D159AE3bFf04a10A355B608D22BDEC092e934fa; // arb
    address public linkToken_sep = 0xb1D4538B4571d411F07960EF2838Ce337FE1E80E; // arb sep
    address public vrfWrapper_sep = 0x1D3bb92db7659F2062438791F131CFA396dfb592; // arb sep
    uint16 public requestConfirmations = 3;
    uint32 public callbackGasLimit = 1_400_000;
    uint8 public totalWinners = 32;

    function run() public {
        if (block.chainid == 31337) {
            deployerPrivateKey = vm.envUint("ANVIL_PRIVATE_KEY");
        } else {
            deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        }

        vm.startBroadcast(deployerPrivateKey);

        // deploy protocol token
        airdropRaffle = new AirdropRaffle(
            vrfWrapper,
            linkToken,
            requestConfirmations,
            callbackGasLimit,
            makeContestantsArray(),
            totalWinners
        );
        // ERC677 lt = ERC677(linkToken);
        // lt.transferAndCall(address(airdropRaffle), 1 ether, bytes(""));

        vm.stopBroadcast();
    }

    function makeContestantsArray() internal returns (address[] memory) {
        address[] memory contestants = new address[](184);
        contestants[0] = 0xce4d12eb3888509E8fe97bC087A2F27F9d425F5E;
        contestants[1] = 0x5A0397d7d467B9b22eE4BC3de2Df230e56B41fB7;
        contestants[2] = 0x521CF86848E5a240232BbC6678AA4Aa89A28A43D;
        contestants[3] = 0x30e72c6B6f465779D18B9ff0F4B32983Ef8d1F3A;
        contestants[4] = 0x18405396C4CEc8447e74D408faBEF1A9C2dC6269;
        contestants[5] = 0x008EF27b8d0B9f8c1FAdcb624ef5FebE4f11fa9f;
        contestants[6] = 0x6A092D806d731f65320c76647C5238600d2c3765;
        contestants[7] = 0x86F5309Fa6BA046dEAeaF97C429591A82b5ff466;
        contestants[8] = 0x11B99A0f275D8cAda9e6eC0c2E1B1e6564084Fea;
        contestants[9] = 0x9F16BBe53cd85E44D5e83CaF7421316F7e81C8CF;
        contestants[10] = 0x0e0392120F5C378890bBbDAdf1DD04d438FAFf71;
        contestants[11] = 0xaf5555536A70EF5daE26FdEE44A04Ab8CC270Ec2;
        contestants[12] = 0x1a7c5e97Cca1027cC3Cc084e78dec7491a66D4d5;
        contestants[13] = 0x4DDCfa21BCF7673046368DC11cA7ba6C1f6B97e4;
        contestants[14] = 0xBF392D1363c8b7C4DF7e0F39f843F87d18033F43;
        contestants[15] = 0xaE7Df639647b7498C75E194C42Eda092D37E33a3;
        contestants[16] = 0xe265c9ded5A4201c66c176c6C182C92D2625061e;
        contestants[17] = 0x99226A1EF791699e863CeF8b2A7622d7a97EB120;
        contestants[18] = 0xfad718a06e4f61Eb6f5510f7ef5aAA54b19939a1;
        contestants[19] = 0x5CF90072DAbb1bF8cecAD5DBAE3Fd49226E9781E;
        contestants[20] = 0xC789026A0f0b15C532c77405491331997F2b2bBC;
        contestants[21] = 0x09A0718CCA56393CAf756279Bb961678C5E820ee;
        contestants[22] = 0xf50097aa29FDD7b7B1edD50E6BA05C21681A1d60;
        contestants[23] = 0x27f476724960e15aA405Ce5A0D43C272A1FAeA0E;
        contestants[24] = 0x73c24b562E2d14B8366Ac3D351e182d6d69B348f;
        contestants[25] = 0x0DB2077E7BD198316bD1aCf0EC808ff67bDbb22B;
        contestants[26] = 0x1a954cEa00077D6A291ec861b015d4d6a592457D;
        contestants[27] = 0x667B5e42a5c80f5dE2FECd34a31f3E7ED28644A7;
        contestants[28] = 0x7941D19bAb4C3529F8DAF77C2BFF615CfCf092D7;
        contestants[29] = 0x12243A169c448d0bb039023039210D9A1084c9a9;
        contestants[30] = 0x5edC64278c74E60DbF5505c1281dE494cdA51056;
        contestants[31] = 0x789B778A299A4E5a1218643fffC6860261951bEd;
        contestants[32] = 0x3572ca2D7845c7E7f396cd6DFf8af93F7Ea67E85;
        contestants[33] = 0xBA9A95795487D4004077F131E68c78E2d3874C7b;
        contestants[34] = 0xaA92dc2DF13Bf72f2e442226afC4bEC1Dbf4e728;
        contestants[35] = 0x9afDa15071686B4131fcA4F8ec5950f69849eBD4;
        contestants[36] = 0xFfb73552c14752570A8609449887Aa60c30AE7f6;
        contestants[37] = 0x334189570814A411C3C77CE90038D7a4aF6Bc008;
        contestants[38] = 0x8182bDe40272AE62539c0DcC64efC54c5Fcf4210;
        contestants[39] = 0xB5bDef1307C360E0F3426548A2217A22D35135db;
        contestants[40] = 0x612DadEbF574505ff11905020C9f4939c98411a0;
        contestants[41] = 0x543b40eE9356b0808F9211a637834B9177C0E87a;
        contestants[42] = 0x39Cd0045E03e3aff2fcf3cdd6A33859Bc91a0023;
        contestants[43] = 0xa8737C2FfC0774f96c1DcAef5A5f82a53DC9e90d;
        contestants[44] = 0x36EFC498e41D0c23F7f47cF68caFaD1A3369c515;
        contestants[45] = 0x31803A1Bd9aa6f6acbdF11AF74F54f1b36d21131;
        contestants[46] = 0x4deDaa1E0A226c8e7f826F1A34d516Ac98599B9b;
        contestants[47] = 0x4735F2b4B36C9D29f0a2188Df8f513f160088ADE;
        contestants[48] = 0x77B1208568a02b866F680bf56da04aC7D045D49F;
        contestants[49] = 0x00393D62F17B07e64f7cdcDF9BdC2fd925b20Bba;
        contestants[50] = 0x9B7D8ba17Fe87DC6965FBE9c944C31987B5C0861;
        contestants[51] = 0x4a470942dd7A44c6574666F8BDa47ce33c19A601;
        contestants[52] = 0x66FF82D63595E957536a4152ee5008E2B6ebb9a2;
        contestants[53] = 0x05e0761Aa6239f8b56327e36Dc8FF681e8B94232;
        contestants[54] = 0x9fCeF36aD0df0Aa11C8c330d9aF7e3285a9AE599;
        contestants[55] = 0xaCf1A9E51682337bA52D4450F6695BF5CF6b0bc3;
        contestants[56] = 0x8B6d247EE106eB79d599e1997247D0759DD51751;
        contestants[57] = 0x80862f82A996F1855D554679412a22191242C789;
        contestants[58] = 0x8D69d98F76DFF5C17F9017950A6dC634467d91F6;
        contestants[59] = 0xB8F80EE8AbcfE155922033543e5FBCF64be02f39;
        contestants[60] = 0x4C99C98c43c0dcB68B38fFd986BBf22B8844A329;
        contestants[61] = 0x80EB628286585Da5aEAB801313aF616dE026bd96;
        contestants[62] = 0xA59C1a5E1B86ef1c182534ED4dB6907B50a59349;
        contestants[63] = 0x01E9387ef6F69FcAabDbE7aD5f2594EE4b83273e;
        contestants[64] = 0xA30BDdEa388a7B33F975A47f1f4497A2AB569227;
        contestants[65] = 0x80B971dd09AA371929fDff45FaF42B16Ef93bC5C;
        contestants[66] = 0x957281643559648722109ee7cDdAb109d3A1dd6c;
        contestants[67] = 0xdff2b57A83cBe6214162D95622057eFFf4CE662a;
        contestants[68] = 0x2a2Ea59595C43140F1A5235f9301d4eA7F8D610C;
        contestants[69] = 0x768ccBb0c70094a7a838Fb9afbD5D9dCA3778F1F;
        contestants[70] = 0xd0C52EE7C692010FE457b7A00de93BE7fD53b012;
        contestants[71] = 0x455D9F8252dd7D1D57963e44857a88a0E50c1D5C;
        contestants[72] = 0x9d100C8890DA6806755BdAd640AAa8FBe2D8451C;
        contestants[73] = 0x04CE35bF4aFfcD47Cd81997e04D7A3173F8D7349;
        contestants[74] = 0x1804909D277e4df2a50de8F9B83969A7D2589C26;
        contestants[75] = 0x2c9bf6F31f79c1102c746AcE184596898c364229;
        contestants[76] = 0xa5445399eB505bbeF5c4C85C3A3eF709b4284bE3;
        contestants[77] = 0xC2EdF07f6823506a386e82aa595a2B5EBB9BDCE6;
        contestants[78] = 0x4112111874dD89D82d50B25D947De2fE937aa80D;
        contestants[79] = 0xeecb2169492d0cC78111afFA6c42e558B2F60E09;
        contestants[80] = 0xf60E69eD3B8cbd43330E31893E28925c8880B2BF;
        contestants[81] = 0xb7d672703E7987715912A0784Be91B27D1098C89;
        contestants[82] = 0xAA30E3f0da0363397C0Bcd62636c9ad2C4690e18;
        contestants[83] = 0xA8f1Ffbae62CC917cb3385Bd4B4061dD7253d981;
        contestants[84] = 0x26Cf23D6E30E03e46e7AbF4D4525F604CEa6f8d4;
        contestants[85] = 0x8A874898ec96c5adA4859d1b8191D2cd1076CEcE;
        contestants[86] = 0x66B1C68066A6eFC53b4F2C72A7A300976Cae47BF;
        contestants[87] = 0xDe000Bf8BF3f3db677359Cd35C523cC415194C00;
        contestants[88] = 0xe5Bf8764C97F9dC7cF0d00e7D50A79feea2D50BC;
        contestants[89] = 0x2f661fbf251BD4942CB1E32b0595bb63cbb0291f;
        contestants[90] = 0xf6Af9DD09a7B7e6CDF9c1e2EC630A9B14c7CfBaa;
        contestants[91] = 0xf7Eab72Ee14daD3DFEf597420F669c25B39f938C;
        contestants[92] = 0xf5E6dB59a6e21Ab1C4037908D663c0f6757BAD8e;
        contestants[93] = 0x6936ff28cA05037e04cBfa31A177ca77b1Cc29C6;
        contestants[94] = 0x138Cc0Ac4D8D5aEb7D7447dB0c49c2907dC95D4B;
        contestants[95] = 0x95ebE5c3eC0166611932F4636dC47a9c3d4182fe;
        contestants[96] = 0x5356df73b293BD9c6e8eFD22C99833391EF8821A;
        contestants[97] = 0xd0F65A28cd82b0f3e3918D5777F5641965d88899;
        contestants[98] = 0xBFe384aD35F6d06badF909D6F41b454ca8ae531A;
        contestants[99] = 0xCac0CA94535893250b7686D36d07c2FD4f26f8A7;
        contestants[100] = 0x1a623E2D0B255bb802eC1795E6D1a41dee9d0767;
        contestants[101] = 0x42a9e4C4b68781B0bb3a212A69B03099f6180cB2;
        contestants[102] = 0xC531496199eFCc5125107f7CDe16fA15b6d88321;
        contestants[103] = 0x75D6F89232F47992F27a513d597C4526906f313c;
        contestants[104] = 0x680aA81866acAcf411325d692e001c0d49497A11;
        contestants[105] = 0x451f476433d92E9235acdb291843210E95dEf1C8;
        contestants[106] = 0x20cf96B69C750eCf4da1F68B8bDA9b1d6614ef56;
        contestants[107] = 0x9e8003a440437938947F2826f4cB157DB0C76967;
        contestants[108] = 0xA5B7eb968974a5E9F3d2264FC293216d15471d3f;
        contestants[109] = 0x1f92DabE3Cfa2dB47666c57a3AE44d820cdEb225;
        contestants[110] = 0x2a230b5906cd2affEF1c414C1328A3c7c7060662;
        contestants[111] = 0xC2aB3DDd5A2bE21aD2331fA70F07Ce99Da858006;
        contestants[112] = 0xD4B5B9EEb26970167605F7891C6b0a9bF9F69b0B;
        contestants[113] = 0xceA077172675bf31e879Bba71fb46C3188591070;
        contestants[114] = 0xD8b158F394c32d66298e5e622de7cC4263BeaC7D;
        contestants[115] = 0xd624a6bcFcC338A4eEc09fbF452AB46d37da147a;
        contestants[116] = 0x3BBF5B5e873543dc90bCaEe9BC98bd8CcD06e60f;
        contestants[117] = 0xdcB337834d21405f919B775c774484a0041FC74f;
        contestants[118] = 0x381B278bbD1a39623ce45b28dd0bC9BB977172A8;
        contestants[119] = 0x5F4CA2878E8f1Ec0677ae073F7c248c9B310FF51;
        contestants[120] = 0x81422e8868BED9F3779538CA3f8E7e4d80f28E52;
        contestants[121] = 0xE4a1baC9Db78D1fb663091649672b09faaeee96e;
        contestants[122] = 0xCBabb0D707dD6CE3b1D68daF788841136907bf52;
        contestants[123] = 0x915E88322EDFa596d29BdF163b5197c53cDB1A68;
        contestants[124] = 0xC98B39D38C5a4Df4161E6a9e9C0EE884F599Cce1;
        contestants[125] = 0xA38EBB71fbc2F686a9147CE16E526D7D248404b6;
        contestants[126] = 0xe851605D05e81D4ceAAd35bAf7f7e9A046648b81;
        contestants[127] = 0x4d4902BD7E080159964f46B10feeb6482d148E5a;
        contestants[128] = 0xacae97388030fdeDcB21466883D01C387cd4C593;
        contestants[129] = 0x079D1984C6fDA8C2fD87fb0426AE50cDa3E0DdF0;
        contestants[130] = 0x3Db1DBc23234a810E42A746b5631eb6d1CDe9669;
        contestants[131] = 0xD3Bd6E2080bD49ab871b97D36Cda9b07bdBdF396;
        contestants[132] = 0xAB2a3fFabb2bC64Dc71E67878A2F22C68BEe2C4D;
        contestants[133] = 0x9301fAD136578E07B7F91a2E0611464cED1FbEf0;
        contestants[134] = 0xf703c156924c880379aCc81Aa2b7F0e4127C8712;
        contestants[135] = 0xDBd2FdA4fd763770e9D229756066DC80B06CA26d;
        contestants[136] = 0xe0bBAFE134aC36a5A32B0Cafe813961Fb0ff9Afc;
        contestants[137] = 0x221856C687333A29BBF5c8F29E7e0247436CCF7D;
        contestants[138] = 0xCD8ad1883687E676210A891494b6075DfF6d00af;
        contestants[139] = 0x0F4a735Adc7383570Fb1CcC50A99ca8064bf5Db4;
        contestants[140] = 0x60eD1f062C82F74c62F91c6689e7b5629a60852a;
        contestants[141] = 0x181b8419478B77EfbF67548125e2003050414fC7;
        contestants[142] = 0x5E3d81f47cdAF4Ff4622A40B3E76fE0b896e5324;
        contestants[143] = 0x710cfF193B29D7dD43c6745365856eF4509A7E87;
        contestants[144] = 0x580C26F142FCD5A4E48b70C0223E2b70Bf720cB8;
        contestants[145] = 0xA32632bCA4C884bcA06fb09eE59Cd0866F7E6843;
        contestants[146] = 0x6D087D3199cFCF49FDc3D96bd82d8F478d3e3279;
        contestants[147] = 0xC2dF6a8Aa0FB93c43a5a1abceD3C06BBC568df4e;
        contestants[148] = 0x2ddC5B7287ae005747851157666b191877d6D533;
        contestants[149] = 0x998324Ff353a833D2432270626700c12D9D1940a;
        contestants[150] = 0x1D841Cf63084aA8D6282076765342c15157BB11E;
        contestants[151] = 0x491F2960e6f4d1C3c27cdBa216c31a0b270d2739;
        contestants[152] = 0x6398D63AF7AdF801F0891AA335Bd0cd1588a54d2;
        contestants[153] = 0xC60b78D93baBF843451192B74DEBf78D414cD7D9;
        contestants[154] = 0x67CEC3Cd50c1C593D02b9bDE548bfd471bd33143;
        contestants[155] = 0xc7029ba924d8684A6fdCDc444608B39bebcB0704;
        contestants[156] = 0x427a9957d3a131EE969a3BB5537070C6aEf03Ea4;
        contestants[157] = 0x62d76Bf057B4d5fe2509b6e95318057DBd6B4c27;
        contestants[158] = 0x0c9DdA6BC87b97C2f7eB0347667E54C570f06dc6;
        contestants[159] = 0x6541607C75bc3aBb53814D38e41f2c373d4C7cA8;
        contestants[160] = 0x9c1eB57aF735F76cAC176DF1578834db8bC86610;
        contestants[161] = 0x6Ce15384Ade20Ee7C2F2f6acCB2Ac4fd6712FA9a;
        contestants[162] = 0xE0786F7AEF1DEAD80A40E1b36e97d7cC043A3716;
        contestants[163] = 0xA37D1bfc67F20aC3d88a3D50e2d315a95161d89c;
        contestants[164] = 0xb4d0E6eF974C31B6b1D9e4d92F1C9B95c0Ac0ce4;
        contestants[165] = 0x945a5d761a2bcDf665A2057BFe870Ad127bA9626;
        contestants[166] = 0x0eABE0E4f4285cD3874c7a7e8bff8f22e2311d9F;
        contestants[167] = 0xfaF8b476A1a01B909d219f983Acb22a363660145;
        contestants[168] = 0x4642A072Ef56BB448684388Ff8E7DbBea41DCF92;
        contestants[169] = 0x3034C00542CAC6bDdA29A53d8e53F6E52B1cA97b;
        contestants[170] = 0x9487A9ebe74E9327bbe2CcD362d83bF01EFe6380;
        contestants[171] = 0x1DceefB43F0ED91fc02231629AbAe40298cD6729;
        contestants[172] = 0x64ADB87Db3147a2A244D936D2aDEfeC2bF10adF1;
        contestants[173] = 0x7eDf4955411b9d42b625E13F7756d50E2819B1fB;
        contestants[174] = 0x223FcD1cc1d1357261fFCE1FC2f6b71671BB2482;
        contestants[175] = 0x739f9535BCD439483a1538431f92F358a80F1801;
        contestants[176] = 0x68C1eCf81b8A960A24423862164a9E18075a6fCF;
        contestants[177] = 0x97d61EBB746C139a3Fa9CC86b5e273e2ebe6629B;
        contestants[178] = 0x400a27F8735BEF28698cd620b50C220e92685466;
        contestants[179] = 0xF882c63168B301910b73479A5D8376c63c5613cd;
        contestants[180] = 0xbD5529bab4B7E432465933020579CaB5581ea1cF;
        contestants[181] = 0xe294D48EA1dCC5BA1A248d2c703c9da3A7777777;
        contestants[182] = 0x541f16168b7aF6265f2Bf5183Fb09419DC9419E3;
        contestants[183] = 0x5c3f89664713A774a0ff3524d72aAdAb27688dD6;

        return contestants;
    }
}