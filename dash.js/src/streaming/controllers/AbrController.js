/**
 * The copyright in this software is being made available under the BSD License,
 * included below. This software may be subject to other third party and contributor
 * rights, including patent rights, and no such rights are granted under this license.
 *
 * Copyright (c) 2013, Dash Industry Forum.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *  * Redistributions of source code must retain the above copyright notice, this
 *  list of conditions and the following disclaimer.
 *  * Redistributions in binary form must reproduce the above copyright notice,
 *  this list of conditions and the following disclaimer in the documentation and/or
 *  other materials provided with the distribution.
 *  * Neither the name of Dash Industry Forum nor the names of its
 *  contributors may be used to endorse or promote products derived from this software
 *  without specific prior written permission.
 *
 *  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS AS IS AND ANY
 *  EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 *  WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
 *  IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT,
 *  INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
 *  NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 *  PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
 *  WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 *  ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 *  POSSIBILITY OF SUCH DAMAGE.
 */

import SwitchRequest from '../rules/SwitchRequest';
import BitrateInfo from '../vo/BitrateInfo';
import DOMStorage from '../utils/DOMStorage';
import ABRRulesCollection from '../rules/abr/ABRRulesCollection';
import MediaPlayerModel from '../models/MediaPlayerModel';
import FragmentModel from '../models/FragmentModel';
import EventBus from '../../core/EventBus';
import Events from '../../core/events/Events';
import FactoryMaker from '../../core/FactoryMaker';
import ManifestModel from '../models/ManifestModel';
import DashManifestModel from '../../dash/models/DashManifestModel';
import VideoModel from '../models/VideoModel';
import DashMetrics from '../../dash/DashMetrics';
import MetricsModel from '../models/MetricsModel';

const ABANDON_LOAD = 'abandonload';
const ALLOW_LOAD = 'allowload';
const DEFAULT_VIDEO_BITRATE = 1000;
const DEFAULT_AUDIO_BITRATE = 100;
const QUALITY_DEFAULT = 0;
//const dashMetrics = this.context.dashMetrics;
//const metricsModel = this.context.metricsModel;

function AbrController() {
    let context = this.context;
    let eventBus = EventBus(context).getInstance();
    let abrAlgo = -1;
    let bitrateArray = [4900, 4900, 4900, 8200, 11700, 32800, 152400, 152400, 260000];
    let reservoir = 5;
    let cushion = 10;
    let p_rb = 1;
    let pastThroughput = [];
    let pastDownloadTime = [];
    let bandwidthEstLog = [];
    let horizon = 5; // number of chunks considered
    let lastRequested = 0;
    let lastQuality = 1;
    let alpha = 12;
    let qualityLog = [];
    let switchUpCount = 0;
    let switchUpThreshold = [0,1,2,3,4,5,6,7,8,9];
    let p = 0.85;
    let lastIndex = -1;
    let instance,
        abrRulesCollection,
        rulesController,
        streamController,
        autoSwitchBitrate,
        topQualities,
        qualityDict,
        confidenceDict,
        bitrateDict,
        ratioDict,
        averageThroughputDict,
        streamProcessorDict,
        abandonmentStateDict,
        abandonmentTimeout,
        limitBitrateByPortal,
        usePixelRatioInLimitBitrateByPortal,
        manifestModel,
        dashManifestModel,
        videoModel,
        dashMetrics,
        metricsModel,
        mediaPlayerModel,
        domStorage;

    function setup() {
        autoSwitchBitrate = {video: true, audio: true};
        topQualities = {};
        qualityDict = {};
        confidenceDict = {};
        bitrateDict = {};
        ratioDict = {};
        averageThroughputDict = {};
        abandonmentStateDict = {};
        streamProcessorDict = {};
        limitBitrateByPortal = false;
        usePixelRatioInLimitBitrateByPortal = false;
        domStorage = DOMStorage(context).getInstance();
        mediaPlayerModel = MediaPlayerModel(context).getInstance();
        manifestModel = ManifestModel(context).getInstance();
        dashManifestModel = DashManifestModel(context).getInstance();
        videoModel = VideoModel(context).getInstance();
        dashMetrics = DashMetrics(context).getInstance();
        metricsModel = MetricsModel(context).getInstance();
    }

    function initialize(type, streamProcessor) {
        streamProcessorDict[type] = streamProcessor;
        abandonmentStateDict[type] = abandonmentStateDict[type] || {};
        abandonmentStateDict[type].state = ALLOW_LOAD;
        eventBus.on(Events.LOADING_PROGRESS, onFragmentLoadProgress, this);


    }

    // returns size of last chunk using HTTPRequest object (not hardcoded :))
    function last_chunk_size(lastreq) {
        var tot = 0;
        for ( var tt = 0; tt < lastreq.trace.length; tt++ ) {
            tot = tot + lastreq.trace[tt]['b'][0];
        }
        return tot;
    }

    function next_chunk_size(index, quality) {
        // Racecar video!
        // index is the index of the *next* chunk
        //var size_video1 = [1680951,1637558,1371111,1684293,1400042,1792609,1213669,1191552,1888982,1381292,1593129,1384566,1918298,1605664,1356382,1278860,1580165,1315506,1642869,928190,1416000,865548,1284104,1692271,1504744,1484004,1405086,891371,1401736,1743545,1084561,1099310,1789869,1675658,1636106,1492615,1200522,1787763,1690817,1459339,1250444,1691788,1403315,1732710,1270067,1514363,1615320,1507682,1260622,1784654,1352160,1115913,1637646,1546975,1637443,1475444,1616179,1113960,466635,1727956,1316739,1373312,458410,320487,573826],
        //size_video2 = [1184008,1123706,854424,1150093,902304,1237428,763515,840707,1279590,930828,996858,950867,1285933,1049248,984261,876058,1054391,875132,996451,660126,1032091,626844,949274,1197901,1001670,994288,925341,623084,977347,1184694,766276,834528,1285071,1017030,1080835,1078945,788728,1165402,1123991,937434,804808,1178153,922947,1175468,903392,970351,1094905,931644,854957,1179875,978233,794797,1073857,942081,1074761,1033448,1181202,660582,297985,1188866,910001,974311,314327,221329,445973],
        //size_video3 = [604139,577615,418531,555427,469238,614632,393715,428426,594788,527047,460827,500774,621760,556545,476734,417508,552639,462442,552256,303234,522859,337637,471941,598737,560588,487684,479873,284277,564825,546935,394056,442514,610493,523364,574457,499175,412705,586327,560284,476697,408166,570011,502061,569274,444948,507586,525450,541979,391886,539537,506089,408110,515570,462132,574826,523754,572621,344553,157240,610010,460871,480012,169331,126490,236234],
        //size_video4 = [361158,370284,246858,357922,264156,371586,241808,270621,327839,334864,313171,253682,348331,319047,311275,282933,308899,289234,307870,207573,354546,208087,305510,364291,331480,298846,298034,195290,327636,354076,261457,272419,344053,307537,344697,301834,261403,332467,324205,276260,260969,357539,301214,320538,292593,290952,325914,285965,266844,327707,308757,271734,313780,284833,295589,331270,307411,224531,94934,385537,306688,310705,95847,78651,162260],
        //size_video5 = [207189,219272,134208,204651,164461,230942,136746,150366,193697,193362,189146,153391,195591,177177,190923,155030,185660,164741,179442,131632,198676,115285,148044,181978,200708,177663,176815,109489,203211,196841,161524,151656,182521,172804,211407,171710,170866,178753,175461,184494,154382,206330,175870,178679,173567,172998,189473,172737,163181,181882,186151,164281,172026,173011,162488,201781,176856,137099,57015,234214,172494,184405,61936,43268,81580];

        // 9-bitrate weird video with 4 second chunks
        var size_video1 = [3898997, 3272180, 2913853, 2910421, 139588203, 108247856, 133590859, 145202943, 128913706, 121653710, 99247241, 100875488, 87415056, 89427267, 85214169, 79066131, 78221353, 81447023, 76954670, 72930723, 73522396, 82545700, 77551456, 71776349, 78162704, 71735089, 74436996, 71945755, 63114763, 73443022, 72984047, 65164657, 75370586, 66117771, 69280544, 72192300, 65447397, 74404067, 70058753, 64080637, 76565788, 65777254, 72423677, 73669436, 66042480, 77362737, 68541110, 67798081, 79191012, 65709626, 76807742, 76692980, 68051292, 80912997, 69802285, 70441275, 85328815, 69184868, 60370749, 51134093, 1009591],
        size_video2 =  [3898997, 3272180, 2913853, 2910421, 139588203, 108247856, 133590859, 145202943, 128913706, 121653710, 99247241, 100875488, 87415056, 89427267, 85214169, 79066131, 78221353, 81447023, 76954670, 72930723, 73522396, 82545700, 77551456, 71776349, 78162704, 71735089, 74436996, 71945755, 63114763, 73443022, 72984047, 65164657, 75370586, 66117771, 69280544, 72192300, 65447397, 74404067, 70058753, 64080637, 76565788, 65777254, 72423677, 73669436, 66042480, 77362737, 68541110, 67798081, 79191012, 65709626, 76807742, 76692980, 68051292, 80912997, 69802285, 70441275, 85328815, 69184868, 60370749, 51134093, 1009591],
        size_video3 =  [3480775, 3272180, 2913853, 2910421, 69724395, 64544235, 68238787, 74122001, 65781674, 59325910, 49489151, 43382003, 36400102, 37808545, 38393683, 35775273, 35791444, 37812996, 36656065, 34260477, 36539495, 34934633, 37472480, 33960930, 37045410, 34761833, 37172626, 36674174, 30526756, 34452372, 35592699, 32282906, 37733948, 32736567, 35135749, 36820652, 32183695, 38477711, 36046409, 31839501, 37331773, 32433344, 36247037, 38145910, 32204109, 38691474, 34760375, 32706773, 38512633, 32012550, 37596161, 38571337, 32377462, 39982696, 35166655, 35445687, 42787799, 36129677, 33509837, 30320113, 801652],
        size_video4 =  [1101519, 2871053, 2627764, 2317007, 11816317, 14671998, 15594921, 15833627, 14174027, 11733096, 9580050, 7692609, 6502714, 6806824, 7216259, 7492657, 7426827, 7150035, 7286507, 7394315, 7435833, 6486352, 6498652, 6280812, 6457313, 6517453, 6664140, 6977807, 6585659, 6883384, 6966632, 6652469, 7066540, 7017975, 7131901, 7822083, 7107849, 7392330, 7794418, 7232282, 7459615, 7359251, 7603000, 7967593, 7470103, 7728465, 7825920, 7364094, 8156901, 7573801, 7967670, 8257179, 7756837, 8766074, 8524286, 8100868, 9138236, 8597720, 8610278, 8859240, 291579],
        size_video5 =  [427088, 1102047, 1111083, 1066380, 3929689, 4658506, 5308892, 4879776, 5465230, 4419693, 3390038, 2621842, 2250224, 2396841, 2489895, 2647781, 2677548, 2616054, 2643911, 2695131, 2677597, 2341766, 2437210, 2403729, 2518938, 2415843, 2436487, 2472325, 2436672, 2389025, 2420818, 2399724, 2451183, 2485412, 2521240, 2620947, 2528167, 2657381, 2605698, 2520434, 2632140, 2625445, 2710856, 2762874, 2628851, 2686664, 2713275, 2691207, 2788080, 2591805, 2657541, 2753887, 2655797, 2852144, 2793004, 2760403, 2872082, 2829935, 2986295, 3129785, 140096],
        size_video6 =  [385365, 790650, 911646, 844970, 2969508, 3365094, 3919884, 3745938, 3431194, 2832778, 2078200, 1615473, 1571858, 1699150, 1782255, 1899687, 1887174, 1858888, 1873405, 1903096, 1899497, 1665126, 1745472, 1740096, 1791801, 1726833, 1758432, 1765517, 1737274, 1686029, 1737778, 1719887, 1759121, 1754600, 1772258, 1813747, 1753351, 1868400, 1801372, 1756670, 1828249, 1780560, 1869204, 1886999, 1815848, 1912505, 1855534, 1857416, 1934818, 1775665, 1843405, 1877606, 1888345, 2073424, 1924796, 1882535, 2006234, 1978624, 2053440, 2063846, 96354],
        size_video7 = [546328, 425156, 613681, 607418, 2007311, 2133418, 2136401, 2246644, 1895081, 1575580, 1143128, 934186, 936528, 1009038, 1057676, 1107721, 1130807, 1095030, 1117429, 1126196, 1166161, 980320, 1007766, 1004743, 1052718, 1020291, 1037792, 1059926, 1060401, 1045758, 1057164, 1030184, 1092837, 1053983, 1047095, 1095862, 1070638, 1117208, 1075777, 1044993, 1108411, 1067549, 1115300, 1119172, 1088201, 1147726, 1099728, 1112580, 1169933, 1065418, 1078575, 1117020, 1145031, 1219157, 1184532, 1162025, 1238364, 1129622, 1080811, 1150968, 60222],
        size_video8 = [546328, 425156, 613681, 607418, 2007311, 2133418, 2136401, 2246644, 1895081, 1575580, 1143128, 934186, 936528, 1009038, 1057676, 1107721, 1130807, 1095030, 1117429, 1126196, 1166161, 980320, 1007766, 1004743, 1052718, 1020291, 1037792, 1059926, 1060401, 1045758, 1057164, 1030184, 1092837, 1053983, 1047095, 1095862, 1070638, 1117208, 1075777, 1044993, 1108411, 1067549, 1115300, 1119172, 1088201, 1147726, 1099728, 1112580, 1169933, 1065418, 1078575, 1117020, 1145031, 1219157, 1184532, 1162025, 1238364, 1129622, 1080811, 1150968, 60222],
        size_video9 = [546328, 425156, 613681, 607418, 2007311, 2133418, 2136401, 2246644, 1895081, 1575580, 1143128, 934186, 936528, 1009038, 1057676, 1107721, 1130807, 1095030, 1117429, 1126196, 1166161, 980320, 1007766, 1004743, 1052718, 1020291, 1037792, 1059926, 1060401, 1045758, 1057164, 1030184, 1092837, 1053983, 1047095, 1095862, 1070638, 1117208, 1075777, 1044993, 1108411, 1067549, 1115300, 1119172, 1088201, 1147726, 1099728, 1112580, 1169933, 1065418, 1078575, 1117020, 1145031, 1219157, 1184532, 1162025, 1238364, 1129622, 1080811, 1150968, 60222];

        // 9-bitrate wierd video with 2 second chunks
        //var size_video1 = [1535564, 1620285, 1269756, 1371500, 1299593, 1110665, 1537560, 1419367, 1443640, 1150344, 1048950, 1338900, 1251304, 1303358, 1481963, 1482209, 1279246, 1261881, 1294098, 1259269, 1288054, 1353055, 1551507, 1325069, 1198053, 1295347, 1521939, 1350854, 1336747, 968044, 1440635, 1415247, 1160228, 1727664, 1187073, 1287849, 1415619, 1413330, 1002890, 1507766, 1242136, 1302168, 1388401, 1251722, 1416202, 1321234, 1178151, 1381047, 1483665, 1144404, 1306854, 1319882, 1589851, 1219615, 1039973, 1294102, 1508564, 1266796, 1594067, 1316179, 1300219, 1186007, 1375130, 1346691, 1162886, 1318148, 1369247, 1680134, 1305914, 1283088, 1324467, 1227251, 1218548, 1177530, 1317341, 1551747, 1138380, 1451108, 1452943, 1143820, 1205956, 1256526, 1423203, 1332599, 1379156, 1294023, 1575368, 1270880, 1324969, 1319305, 1266576, 1493740, 1211363, 1099485, 1352346, 1294667, 826712],
        //    size_video2 = [1145867, 1208905, 931675, 1191390, 1057080, 1119993, 1026761, 1134116, 1245559, 987497, 866042, 1075583, 1028110, 1129425, 1200782, 1089390, 988925, 1066544, 1106191, 1063010, 1110709, 1062813, 1023521, 1078931, 1013406, 1196057, 1208483, 1066893, 1053130, 952269, 1089380, 1063103, 1015405, 1274284, 960433, 1099079, 1120348, 1100378, 962301, 1194428, 1021594, 1018179, 1128044, 1048425, 1172522, 1048984, 937673, 1106402, 1230806, 955984, 1014536, 1090695, 1259901, 1135687, 796181, 1175867, 1018254, 1116360, 1118076, 1046064, 1047156, 1066037, 1087601, 1060251, 1093037, 1098037, 1065720, 1221041, 1172284, 1135503, 1111459, 1032489, 929057, 990724, 968221, 1179246, 984872, 1148998, 1126258, 1019862, 1045316, 1063175, 1086668, 1097903, 1075409, 1046519, 1172168, 1046934, 1041771, 1083179, 1039387, 1207119, 981184, 979956, 1074550, 1080462, 716829],
        //    size_video3 = [838177, 890702, 651428, 780381, 655721, 645147, 795676, 724605, 865600, 606958, 541774, 682486, 694157, 694246, 802642, 836127, 667592, 680419, 724714, 705051, 633275, 721273, 837102, 682849, 695459, 727460, 825782, 752561, 673680, 557765, 678997, 792068, 655603, 836023, 674271, 684530, 776218, 760938, 566838, 769212, 734163, 680953, 796704, 671422, 791202, 714558, 595055, 728935, 733271, 650464, 718126, 762338, 850550, 697022, 499827, 642144, 742392, 756078, 818999, 742264, 660056, 681145, 709784, 787899, 656266, 701815, 773105, 814188, 796431, 696241, 728458, 711438, 549722, 589569, 662264, 836745, 642226, 785252, 792766, 609521, 649530, 689970, 743514, 783785, 671295, 671707, 923362, 663888, 738933, 725988, 658877, 824650, 663951, 567505, 642371, 722166, 444706],
        //    size_video4 = [495048, 539060, 437741, 519944, 415491, 462280, 484055, 449221, 574817, 421932, 372339, 428719, 439072, 466443, 534691, 525796, 441111, 411722, 456147, 457741, 462377, 477442, 467687, 449741, 457375, 489476, 521611, 514843, 463299, 358332, 457104, 466066, 433614, 533085, 405177, 480537, 514593, 473115, 371722, 552033, 451259, 440345, 494837, 460394, 511811, 456215, 428734, 445441, 470212, 427764, 444101, 461834, 565945, 510654, 341943, 416254, 495342, 477456, 490721, 485090, 459017, 414412, 459491, 494962, 428526, 456536, 477188, 558141, 530351, 495705, 475834, 468108, 353512, 375450, 431352, 507235, 415898, 492767, 506488, 424089, 452910, 405540, 512319, 512686, 431588, 454667, 547853, 426119, 496972, 462022, 447379, 534685, 450418, 380312, 384989, 461381, 299425],
        //    size_video5 = [327613, 340673, 276919, 334168, 288757, 282294, 302840, 314841, 377182, 275692, 235035, 285280, 284149, 277642, 363649, 345885, 297290, 287556, 265573, 295248, 296546, 310864, 311963, 282115, 302189, 322093, 356218, 331153, 298737, 228213, 276952, 310924, 277828, 339414, 272818, 308675, 338685, 300519, 249937, 336902, 296437, 305301, 324368, 291838, 337157, 319314, 262029, 274638, 312753, 274483, 290243, 300092, 374242, 322134, 228278, 258882, 321476, 301420, 332540, 308907, 300873, 269519, 307698, 312585, 282432, 301917, 319380, 350749, 368023, 322230, 309314, 289413, 239148, 248664, 259764, 315827, 274832, 331052, 325385, 262121, 301419, 265485, 330862, 310590, 303327, 296150, 359626, 275235, 329656, 300547, 295821, 342840, 294842, 243770, 250973, 299933, 195725],
        //    size_video6 = [218953, 231330, 189055, 209810, 173551, 177261, 192106, 190249, 244719, 166842, 144451, 174113, 155385, 197257, 214125, 223037, 188432, 186326, 173759, 189036, 164860, 188360, 216458, 188676, 193547, 192804, 218223, 216186, 190601, 146458, 175934, 190280, 178660, 182171, 178984, 193979, 211644, 193952, 149419, 201294, 198269, 188203, 215218, 184676, 205911, 195942, 165344, 178456, 183414, 176489, 183089, 196611, 226486, 199295, 146202, 131514, 198153, 202243, 202296, 198212, 201625, 156593, 193435, 206887, 173993, 195841, 202095, 210742, 229255, 171833, 210226, 154935, 165847, 155217, 151742, 209823, 182646, 195681, 220617, 170063, 155313, 190203, 183299, 201206, 186793, 185300, 254643, 183638, 205106, 193881, 180990, 212814, 177217, 153836, 136731, 177376, 127977],
        //    size_video7 = [141282, 155827, 125040, 132607, 112034, 114896, 128783, 123227, 153185, 98829, 91248, 113559, 99498, 123232, 144645, 147821, 130594, 120658, 108676, 116393, 99197, 120017, 147651, 116841, 123631, 126590, 142765, 139888, 108656, 94771, 113881, 127315, 115095, 117183, 116064, 120714, 133999, 123482, 100333, 138757, 127851, 122093, 136872, 115124, 135495, 119260, 98662, 116296, 127350, 109471, 120123, 127296, 149628, 123861, 86384, 83717, 124461, 134057, 132811, 124026, 129450, 116099, 124053, 130463, 106432, 121818, 128740, 136393, 146766, 119155, 116658, 111724, 106768, 100540, 99244, 131075, 110452, 120822, 141803, 115278, 103398, 107080, 118718, 128730, 121092, 117544, 170763, 120712, 135391, 121879, 121149, 138163, 115203, 103073, 84570, 107278, 72118],
        //    size_video8 = [87486, 94315, 72359, 83221, 69454, 70403, 80447, 74985, 93429, 70013, 57408, 68881, 68664, 84631, 85468, 88381, 77573, 73137, 66739, 72366, 65243, 76597, 85767, 70381, 77722, 83024, 92471, 87330, 81250, 58801, 65418, 72895, 72592, 70917, 73337, 77279, 87034, 78350, 62807, 78074, 78628, 79043, 82951, 74861, 85635, 78292, 66474, 71180, 73720, 73034, 74564, 79374, 95994, 85907, 57365, 53790, 75974, 77631, 72618, 76411, 84619, 72802, 76840, 80648, 68498, 75383, 77996, 85448, 90638, 88690, 85088, 74826, 63965, 67645, 51279, 72732, 70543, 73711, 83697, 66294, 74364, 73604, 78605, 83252, 71766, 73444, 100122, 72190, 85506, 81519, 77235, 82829, 73288, 64219, 52565, 65856, 56135],
        //    size_video9 = [59721, 74169, 55032, 56752, 47530, 48364, 52820, 49355, 64369, 36633, 43649, 48694, 42830, 45718, 63990, 62758, 50828, 51562, 46648, 48850, 44969, 49044, 60496, 50175, 53080, 52660, 56317, 52637, 49375, 42919, 50742, 53291, 45243, 50672, 52599, 49961, 55560, 51362, 40881, 50600, 55679, 55011, 53260, 48729, 51771, 52515, 44112, 50897, 53045, 46375, 53733, 50278, 61823, 44786, 36547, 39424, 52936, 59631, 51464, 52019, 57212, 48904, 49561, 51894, 46883, 51827, 52188, 55886, 55434, 53024, 41482, 52031, 47934, 47183, 44698, 51038, 47461, 51041, 57897, 43518, 43460, 43535, 45080, 56131, 49937, 49600, 77138, 51357, 54264, 51314, 51060, 58447, 44994, 38175, 46089, 49101, 28312];


        // upper number is 96 if 2 second chunks for weird video
        // if 4 second chunks, make that number 48
        // 64 for old video (racecar)
        if (index < 0 || index >48) {
            return 0;
        }
        var chunkSize = [size_video1[index], size_video2[index], size_video3[index], size_video4[index], size_video5[index], size_video6[index], size_video7[index], size_video8[index], size_video9[index]];
        //switch (quality) {
        //    case 4:
        //        chunkSize = size_video1[index];
        //        break;
        //    case 3:
        //        chunkSize = size_video2[index];
        //        break;
        //    case 2:
        //        chunkSize = size_video3[index];
        //        break;
        //    case 1:
        //        chunkSize = size_video4[index];
        //        break;
        //    case 0:
        //        chunkSize = size_video5[index];
        //        break;
        //    default:
        //        chunkSize = 0;
        //        break;
        //}
        return chunkSize;
    }

    function getStabilityScore(b, b_ref, b_cur) {
        var score = 0,
        n = 0;
        if (lastIndex >= 1) {
            for (var i = Math.max(0, lastIndex + 1 - horizon); i<= lastIndex - 1; i++) {
            if (qualityLog[i] != qualityLog[i+1]) {
                n = n + 1;
            }
            }
        }
        if (b != b_cur) {
            n = n + 1;
        }
        score = Math.pow(2,n);
        return score;
    }

    function getEfficiencyScore(b, b_ref, w, bitrateArray) {
        var score = 0;
        score = Math.abs( bitrateArray[b]/Math.min(w, bitrateArray[b_ref]) - 1 );
        return score;
        }

        function getCombinedScore(b, b_ref, b_cur, w, bitrateArray) {
        var stabilityScore = 0,
        efficiencyScore = 0,
        totalScore = 0;
        // compute
        stabilityScore = getStabilityScore(b, b_ref, b_cur);
        efficiencyScore = getEfficiencyScore(b, b_ref, w, bitrateArray);
        totalScore = stabilityScore + alpha*efficiencyScore;
        return totalScore;  
    }

    function getBitrateFestive(prevQuality, bufferLevel, bwPrediction, lastRequested, bitrateArray) {
        var self = this, 
        bitrate = 0,
        tmpBitrate = 0,
        b_target = 0,
        b_ref = 0,
        b_cur = prevQuality + 2,
        score_cur = 0,
        score_ref = 0;
        // TODO: implement FESTIVE logic
        // 1. log previous quality
        qualityLog[lastRequested] = prevQuality;
        lastIndex = lastRequested;
        // 2. compute b_target
        tmpBitrate = p*bwPrediction;
        for (var i = 7; i>=2; i--) { // todo: use bitrateArray.length
            if (bitrateArray[i] <= tmpBitrate) {
                b_target = i;
                break;
            }
            b_target = i;
        }
        // 3. compute b_ref
        if (b_target > b_cur) {
            switchUpCount = switchUpCount + 1;
            if (switchUpCount > switchUpThreshold[b_cur]) {
            b_ref = b_cur + 1;
            } else {
            b_ref = b_cur;
            }
        } else if (b_target < b_cur) {
            b_ref = b_cur - 1;
            switchUpCount = 0;
        } else {
            b_ref = b_cur;
            switchUpCount = 0; // this means need k consecutive "up" to actually switch up
        }
        // 4. delayed update
        if (b_ref != b_cur) { // need to switch
            // compute scores
            score_cur = getCombinedScore(b_cur, b_ref, b_cur, bwPrediction, bitrateArray);
            score_ref = getCombinedScore(b_ref, b_ref, b_cur, bwPrediction, bitrateArray);
            if (score_cur <= score_ref) {
            bitrate = b_cur;
            } else {
            bitrate = b_ref;
            if (bitrate > b_cur) { // clear switchupcount
                switchUpCount = 0;
            }
            }
        } else {
            bitrate = b_cur;
        }
        if (bitrate > 2) {
            bitrate -= 2;
        }
        // 5. return
        return bitrate;
    }

    function predict_throughput(lastRequested, lastQuality, lastHTTPRequest) {
        var self = this,
        bandwidthEst = 0,
        lastDownloadTime,
        lastThroughput,
        lastChunkSize,
        tmpIndex,
        tmpSum = 0,
        tmpDownloadTime = 0;
        // First, log last download time and throughput
        if (lastHTTPRequest && lastRequested >= 0) {
            lastDownloadTime = (lastHTTPRequest._tfinish.getTime() - lastHTTPRequest.tresponse.getTime()) / 1000; //seconds
            if (lastDownloadTime <0.1) {
            lastDownloadTime = 0.1;
            }
            lastChunkSize = last_chunk_size(lastHTTPRequest);
            //lastChunkSize = self.vbr.getChunkSize(lastRequested, lastQuality);
            lastThroughput = lastChunkSize*8/lastDownloadTime/1000;
            // Log last chunk
            pastThroughput[lastRequested] = lastThroughput;
            pastDownloadTime[lastRequested] = lastDownloadTime;
        }
        // Next, predict future bandwidth
        if (pastThroughput.length === 0) {
            return 0;
        } else {
            tmpIndex = Math.max(0, lastRequested + 1 - horizon);
            tmpSum = 0;
            tmpDownloadTime = 0;
            for (var i = tmpIndex; i<= lastRequested; i++) {
            tmpSum = tmpSum + pastDownloadTime[i]/pastThroughput[i];
            tmpDownloadTime = tmpDownloadTime + pastDownloadTime[i];
            }
            bandwidthEst = tmpDownloadTime/tmpSum;
            bandwidthEstLog[lastRequested] = bandwidthEst;
            return bandwidthEst;
        }   
    }

    function setConfig(config) {
        if (!config) return;

        if (config.abrRulesCollection) {
            abrRulesCollection = config.abrRulesCollection;
        }
        if (config.rulesController) {
            rulesController = config.rulesController;
        }
        if (config.streamController) {
            streamController = config.streamController;
        }
    }

    function getBitrateBB(bLevel) {
        var self = this,
        tmpBitrate = 0,
        tmpQuality = 0;
        if (bLevel <= reservoir) {
            tmpBitrate = bitrateArray[0];
        } else if (bLevel > reservoir + cushion) {
            tmpBitrate = bitrateArray[8];
        } else {
            tmpBitrate = bitrateArray[0] + (bitrateArray[8] - bitrateArray[0])*(bLevel - reservoir)/cushion;
        }
        
        // findout matching quality level
        for (var i = 9; i>=0; i--) {
            if (tmpBitrate >= bitrateArray[i]) {
                tmpQuality = i;
                break;
            }
            tmpQuality = i;
        }
        //return 9;
        return tmpQuality;
        // return 0;
    }

    function getBitrateRB(bandwidth) {
        var self = this,
        tmpBitrate = 0,
        tmpQuality = 0;
        
        tmpBitrate = bandwidth*p_rb;
        
        // findout matching quality level
        for (var i = 7; i>=2; i--) {
            if (tmpBitrate >= bitrateArray[i]) {
                tmpQuality = i;
                break;
            }
            tmpQuality = i;
        }
        return tmpQuality-2;  
        // return 0;
    }

    function getTopQualityIndexFor(type, id) {
        var idx;
        topQualities[id] = topQualities[id] || {};

        if (!topQualities[id].hasOwnProperty(type)) {
            topQualities[id][type] = 0;
        }

        idx = checkMaxBitrate(topQualities[id][type], type);
        idx = checkMaxRepresentationRatio(idx, type, topQualities[id][type]);
        idx = checkPortalSize(idx, type);
        return idx;
    }

    /**
     * @param {string} type
     * @returns {number} A value of the initial bitrate, kbps
     * @memberof AbrController#
     */
    function getInitialBitrateFor(type) {

        let savedBitrate = domStorage.getSavedBitrateSettings(type);

        if (!bitrateDict.hasOwnProperty(type)) {
            if (ratioDict.hasOwnProperty(type)) {
                let manifest = manifestModel.getValue();
                let representation = dashManifestModel.getAdaptationForType(manifest, 0, type).Representation;

                if (Array.isArray(representation)) {
                    let repIdx = Math.max(Math.round(representation.length * ratioDict[type]) - 1, 0);
                    bitrateDict[type] = representation[repIdx].bandwidth;
                } else {
                    bitrateDict[type] = 0;
                }
            } else if (!isNaN(savedBitrate)) {
                bitrateDict[type] = savedBitrate;
            } else {
                bitrateDict[type] = (type === 'video') ? DEFAULT_VIDEO_BITRATE : DEFAULT_AUDIO_BITRATE;
            }
        }

        return bitrateDict[type];
    }

    /**
     * @param {string} type
     * @param {number} value A value of the initial bitrate, kbps
     * @memberof AbrController#
     */
    function setInitialBitrateFor(type, value) {
        bitrateDict[type] = value;
    }

    function getInitialRepresentationRatioFor(type) {
        if (!ratioDict.hasOwnProperty(type)) {
            return null;
        }

        return ratioDict[type];
    }

    function setInitialRepresentationRatioFor(type, value) {
        ratioDict[type] = value;
    }

    function getMaxAllowedBitrateFor(type) {
        if (bitrateDict.hasOwnProperty('max') && bitrateDict.max.hasOwnProperty(type)) {
            return bitrateDict.max[type];
        }
        return NaN;
    }

    //TODO  change bitrateDict structure to hold one object for video and audio with initial and max values internal.
    // This means you need to update all the logic around initial bitrate DOMStorage, RebController etc...
    function setMaxAllowedBitrateFor(type, value) {
        bitrateDict.max = bitrateDict.max || {};
        bitrateDict.max[type] = value;
    }

    function getMaxAllowedRepresentationRatioFor(type) {
        if (ratioDict.hasOwnProperty('max') && ratioDict.max.hasOwnProperty(type)) {
            return ratioDict.max[type];
        }
        return 1;
    }

    function setMaxAllowedRepresentationRatioFor(type, value) {
        ratioDict.max = ratioDict.max || {};
        ratioDict.max[type] = value;
    }

    function getAutoSwitchBitrateFor(type) {
        return autoSwitchBitrate[type];
    }

    function setAutoSwitchBitrateFor(type, value) {
        autoSwitchBitrate[type] = value;
    }

    function getLimitBitrateByPortal() {
        return limitBitrateByPortal;
    }

    function setLimitBitrateByPortal(value) {
        limitBitrateByPortal = value;
    }

    function getUsePixelRatioInLimitBitrateByPortal() {
        return usePixelRatioInLimitBitrateByPortal;
    }

    function setUsePixelRatioInLimitBitrateByPortal(value) {
        usePixelRatioInLimitBitrateByPortal = value;
    }

    function nextChunkQuality(buffer, lastRequested, lastQuality, rebuffer) {
        const metrics = metricsModel.getReadOnlyMetricsFor('video');
        //console.log("ORIG THROUGH: " + getAverageThroughput("video"));
        //var lastHTTPRequest = dashMetrics.getHttpRequests(metricsModel.getReadOnlyMetricsFor('video'))[lastRequested];
        var lastHTTPRequest = dashMetrics.getCurrentHttpRequest(metrics);
        var bandwidthEst = predict_throughput(lastRequested, lastQuality, lastHTTPRequest);
        switch(abrAlgo) {
            case 2:
                var xhr = new XMLHttpRequest();
                xhr.open("POST", "http://localhost:8333", false);
                xhr.onreadystatechange = function() {
                    if ( xhr.readyState == 4 && xhr.status == 200 ) {
                        console.log("GOT RESPONSE:" + xhr.responseText + "---");
                        if ( xhr.responseText == "REFRESH" ) {
                            document.location.reload(true);
                        }
                    }
                }
                var data = {'nextChunkSize': next_chunk_size(lastRequested+1), 'Type': 'BB', 'lastquality': lastQuality, 'buffer': buffer, 'bufferAdjusted': bufferLevelAdjusted, 'bandwidthEst': bandwidthEst, 'lastRequest': lastRequested, 'RebufferTime': rebuffer, 'lastChunkFinishTime': lastHTTPRequest._tfinish.getTime(), 'lastChunkStartTime': lastHTTPRequest.tresponse.getTime(), 'lastChunkSize': last_chunk_size(lastHTTPRequest)};
                xhr.send(JSON.stringify(data));
                return getBitrateBB(buffer);
            case 3:
                var quality = 2;
                var xhr = new XMLHttpRequest();
                xhr.open("POST", "http://localhost:8333", false);
                xhr.onreadystatechange = function() {
                    if ( xhr.readyState == 4 && xhr.status == 200 ) {
                        console.log("GOT RESPONSE:" + xhr.responseText + "---");
                        if ( xhr.responseText != "REFRESH" ) {
                            quality = parseInt(xhr.responseText, 10);
                        } else {
                            document.location.reload(true);
                        }
                    }
                }
                var data = {'nextChunkSize': next_chunk_size(lastRequested+1), 'Type': 'RB', 'lastquality': lastQuality, 'buffer': buffer, 'bufferAdjusted': bufferLevelAdjusted, 'bandwidthEst': bandwidthEst, 'lastRequest': lastRequested, 'RebufferTime': rebuffer, 'lastChunkFinishTime': lastHTTPRequest._tfinish.getTime(), 'lastChunkStartTime': lastHTTPRequest.tresponse.getTime(), 'lastChunkSize': last_chunk_size(lastHTTPRequest)};
                xhr.send(JSON.stringify(data));
                return getBitrateRB(bandwidthEst);
            case 4:
                var quality = 2;
                var xhr = new XMLHttpRequest();
                xhr.open("POST", "http://localhost:8333", false);
                xhr.onreadystatechange = function() {
                    if ( xhr.readyState == 4 && xhr.status == 200 ) {
                        console.log("GOT RESPONSE:" + xhr.responseText + "---");
                        if ( xhr.responseText != "REFRESH" ) {
                            quality = parseInt(xhr.responseText, 10);
                        } else {
                            document.location.reload(true);
                        }
                    }
                }
                var bufferLevelAdjusted = buffer-0.15-0.4-4;
                var data = {'nextChunkSize': next_chunk_size(lastRequested+1), 'lastquality': lastQuality, 'buffer': buffer, 'bufferAdjusted': bufferLevelAdjusted, 'bandwidthEst': bandwidthEst, 'lastRequest': lastRequested, 'RebufferTime': rebuffer, 'lastChunkFinishTime': lastHTTPRequest._tfinish.getTime(), 'lastChunkStartTime': lastHTTPRequest.tresponse.getTime(), 'lastChunkSize': last_chunk_size(lastHTTPRequest)};
                xhr.send(JSON.stringify(data));
                console.log("QUALITY RETURNED IS: " + quality);
                return quality;
            case 5:
                var xhr = new XMLHttpRequest();
                xhr.open("POST", "http://localhost:8333", false);
                xhr.onreadystatechange = function() {
                    if ( xhr.readyState == 4 && xhr.status == 200 ) {
                        console.log("GOT RESPONSE:" + xhr.responseText + "---");
                        if ( xhr.responseText == "REFRESH" ) {
                            document.location.reload(true);
                        }
                    }
                }
                var data = {'nextChunkSize': next_chunk_size(lastRequested+1), 'Type': 'Festive', 'lastquality': lastQuality, 'buffer': buffer, 'bufferAdjusted': bufferLevelAdjusted, 'bandwidthEst': bandwidthEst, 'lastRequest': lastRequested, 'RebufferTime': rebuffer, 'lastChunkFinishTime': lastHTTPRequest._tfinish.getTime(), 'lastChunkStartTime': lastHTTPRequest.tresponse.getTime(), 'lastChunkSize': last_chunk_size(lastHTTPRequest)};
                xhr.send(JSON.stringify(data));
                var bufferLevelAdjusted = buffer-0.15-0.4-4;
                return getBitrateFestive(lastQuality, bufferLevelAdjusted, bandwidthEst, lastRequested, bitrateArray);
            case 6:
                var xhr = new XMLHttpRequest();
                xhr.open("POST", "http://localhost:8333", false);
                xhr.onreadystatechange = function() {
                    if ( xhr.readyState == 4 && xhr.status == 200 ) {
                        console.log("GOT RESPONSE:" + xhr.responseText + "---");
                        if ( xhr.responseText == "REFRESH" ) {
                            document.location.reload(true);
                        }
                    }
                }
                var data = {'nextChunkSize': next_chunk_size(lastRequested+1), 'Type': 'Bola', 'lastquality': lastQuality, 'buffer': buffer, 'bufferAdjusted': bufferLevelAdjusted, 'bandwidthEst': bandwidthEst, 'lastRequest': lastRequested, 'RebufferTime': rebuffer, 'lastChunkFinishTime': lastHTTPRequest._tfinish.getTime(), 'lastChunkStartTime': lastHTTPRequest.tresponse.getTime(), 'lastChunkSize': last_chunk_size(lastHTTPRequest)};
                xhr.send(JSON.stringify(data));
                return -1;
            default:
                // defaults to lowest quality always
                var xhr = new XMLHttpRequest();
                xhr.open("POST", "http://localhost:8333", false);
                xhr.onreadystatechange = function() {
                    if ( xhr.readyState == 4 && xhr.status == 200 ) {
                        console.log("GOT RESPONSE:" + xhr.responseText + "---");
                        if ( xhr.responseText == "REFRESH" ) {
                            document.location.reload(true);
                        }
                    }
                }
                var data = {'nextChunkSize': next_chunk_size(lastRequested+1), 'Type': 'Fixed Quality (0)', 'lastquality': 0, 'buffer': buffer, 'bufferAdjusted': bufferLevelAdjusted, 'bandwidthEst': bandwidthEst, 'lastRequest': lastRequested, 'RebufferTime': rebuffer, 'lastChunkFinishTime': lastHTTPRequest._tfinish.getTime(), 'lastChunkStartTime': lastHTTPRequest.tresponse.getTime(), 'lastChunkSize': last_chunk_size(lastHTTPRequest)};
                xhr.send(JSON.stringify(data));
                return 0;
        }
    }

    function getPlaybackQuality(streamProcessor, completedCallback, buffer=0, rebuffer=0) {
        const type = streamProcessor.getType();
        const streamInfo = streamProcessor.getStreamInfo();
        const streamId = streamInfo.id;

        const callback = function (res) {

            const topQualityIdx = getTopQualityIndexFor(type, streamId);

            let newQuality = res.value;
            if (newQuality < 0) {
                newQuality = 0;
            }
            if (newQuality > topQualityIdx) {
                newQuality = topQualityIdx;
            }

            const oldQuality = getQualityFor(type, streamInfo);
            if (newQuality !== oldQuality && (abandonmentStateDict[type].state === ALLOW_LOAD || newQuality > oldQuality)) {
                setConfidenceFor(type, streamId, res.confidence);
                changeQuality(type, streamInfo, oldQuality, newQuality, res.reason);
            }
            if (completedCallback) {
                completedCallback();
            }
        };

        //log("ABR enabled? (" + autoSwitchBitrate + ")");
        if (!getAutoSwitchBitrateFor(type)) {
            if (completedCallback) {
                completedCallback();
            }
        } else {
            const rules = abrRulesCollection.getRules(ABRRulesCollection.QUALITY_SWITCH_RULES);
            rulesController.applyRules(rules, streamProcessor, callback, getQualityFor(type, streamInfo), function (currentValue, newValue) {
                currentValue = currentValue === SwitchRequest.NO_CHANGE ? 0 : currentValue;
                if ( abrAlgo == 0 ) { // use the default return value
                    const metrics = metricsModel.getReadOnlyMetricsFor('video');
                    var lastHTTPRequest = dashMetrics.getCurrentHttpRequest(metrics);
                    var bandwidthEst = predict_throughput(lastRequested, lastQuality, lastHTTPRequest);
                    // defaults to lowest quality always
                    var xhr = new XMLHttpRequest();
                    xhr.open("POST", "http://localhost:8333", false);
                    xhr.onreadystatechange = function() {
                        if ( xhr.readyState == 4 && xhr.status == 200 ) {
                            console.log("GOT RESPONSE:" + xhr.responseText + "---");
                            if ( xhr.responseText == "REFRESH" ) {
                                document.location.reload(true);
                            }
                        }
                    }
                    var bufferLevelAdjusted = buffer-0.15-0.4-4;
                    var data = {'nextChunkSize': next_chunk_size(lastRequested+1), 'Type': 'Default', 'lastquality': 0, 'buffer': buffer, 'bufferAdjusted': bufferLevelAdjusted, 'bandwidthEst': bandwidthEst, 'lastRequest': lastRequested, 'RebufferTime': rebuffer, 'lastChunkFinishTime': lastHTTPRequest._tfinish.getTime(), 'lastChunkStartTime': lastHTTPRequest.tresponse.getTime(), 'lastChunkSize': last_chunk_size(lastHTTPRequest)};
                    xhr.send(JSON.stringify(data));
                    return Math.max(currentValue, newValue);
                }
                lastQuality = nextChunkQuality(buffer, lastRequested, lastQuality, rebuffer);
                lastRequested = lastRequested + 1;
                if ( abrAlgo == 6 ) {
                    lastQuality = Math.max(currentValue, newValue);
                    return Math.max(currentValue, newValue);
                }
                newValue = lastQuality;
                return lastQuality;
            });
        }
    }

    function setAbrAlgorithm(algo) {
        abrAlgo = algo;
    }

    function setPlaybackQuality(type, streamInfo, newQuality, reason) {
        const id = streamInfo.id;
        const oldQuality = getQualityFor(type, streamInfo);
        const isInt = newQuality !== null && !isNaN(newQuality) && (newQuality % 1 === 0);

        if (!isInt) throw new Error('argument is not an integer');

        if (newQuality !== oldQuality && newQuality >= 0 && newQuality <= getTopQualityIndexFor(type, id)) {
            changeQuality(type, streamInfo, oldQuality, newQuality, reason);
        }
    }

    function changeQuality(type, streamInfo, oldQuality, newQuality, reason) {
        setQualityFor(type, streamInfo.id, newQuality);
        eventBus.trigger(Events.QUALITY_CHANGE_REQUESTED, {mediaType: type, streamInfo: streamInfo, oldQuality: oldQuality, newQuality: newQuality, reason: reason});
    }


    function setAbandonmentStateFor(type, state) {
        abandonmentStateDict[type].state = state;
    }

    function getAbandonmentStateFor(type) {
        return abandonmentStateDict[type].state;
    }

    /**
     * @param {MediaInfo} mediaInfo
     * @param {number} bitrate A bitrate value, kbps
     * @returns {number} A quality index <= for the given bitrate
     * @memberof AbrController#
     */
    function getQualityForBitrate(mediaInfo, bitrate) {

        const bitrateList = getBitrateList(mediaInfo);

        if (!bitrateList || bitrateList.length === 0) {
            return QUALITY_DEFAULT;
        }

        for (let i = bitrateList.length - 1; i >= 0; i--) {
            const bitrateInfo = bitrateList[i];
            if (bitrate * 1000 >= bitrateInfo.bitrate) {
                return i;
            }
        }
        return 0;
    }

    /**
     * @param {MediaInfo} mediaInfo
     * @returns {Array|null} A list of {@link BitrateInfo} objects
     * @memberof AbrController#
     */
    function getBitrateList(mediaInfo) {
        if (!mediaInfo || !mediaInfo.bitrateList) return null;

        var bitrateList = mediaInfo.bitrateList;
        var type = mediaInfo.type;

        var infoList = [];
        var bitrateInfo;

        for (var i = 0, ln = bitrateList.length; i < ln; i++) {
            bitrateInfo = new BitrateInfo();
            bitrateInfo.mediaType = type;
            bitrateInfo.qualityIndex = i;
            bitrateInfo.bitrate = bitrateList[i].bandwidth;
            bitrateInfo.width = bitrateList[i].width;
            bitrateInfo.height = bitrateList[i].height;
            infoList.push(bitrateInfo);
        }

        return infoList;
    }

    function setAverageThroughput(type, value) {
        averageThroughputDict[type] = value;
    }

    function getAverageThroughput(type) {
        return averageThroughputDict[type];
    }

    function updateTopQualityIndex(mediaInfo) {
        var type = mediaInfo.type;
        var streamId = mediaInfo.streamInfo.id;
        var max = mediaInfo.representationCount - 1;

        setTopQualityIndex(type, streamId, max);

        return max;
    }

    function isPlayingAtTopQuality(streamInfo) {
        var isAtTop;
        var streamId = streamInfo.id;
        var audioQuality = getQualityFor('audio', streamInfo);
        var videoQuality = getQualityFor('video', streamInfo);

        isAtTop = (audioQuality === getTopQualityIndexFor('audio', streamId)) &&
            (videoQuality === getTopQualityIndexFor('video', streamId));

        return isAtTop;
    }

    function reset () {
        eventBus.off(Events.LOADING_PROGRESS, onFragmentLoadProgress, this);
        clearTimeout(abandonmentTimeout);
        abandonmentTimeout = null;
        setup();
    }

    function getQualityFor(type, streamInfo) {
        var id = streamInfo.id;
        var quality;

        qualityDict[id] = qualityDict[id] || {};

        if (!qualityDict[id].hasOwnProperty(type)) {
            qualityDict[id][type] = QUALITY_DEFAULT;
        }

        quality = qualityDict[id][type];
        return quality;
    }

    function setQualityFor(type, id, value) {
        qualityDict[id] = qualityDict[id] || {};
        qualityDict[id][type] = value;
    }

    function getConfidenceFor(type, id) {
        var confidence;

        confidenceDict[id] = confidenceDict[id] || {};

        if (!confidenceDict[id].hasOwnProperty(type)) {
            confidenceDict[id][type] = 0;
        }

        confidence = confidenceDict[id][type];

        return confidence;
    }

    function setConfidenceFor(type, id, value) {
        confidenceDict[id] = confidenceDict[id] || {};
        confidenceDict[id][type] = value;
    }

    function setTopQualityIndex(type, id, value) {
        topQualities[id] = topQualities[id] || {};
        topQualities[id][type] = value;
    }

    function checkMaxBitrate(idx, type) {
        var maxBitrate = getMaxAllowedBitrateFor(type);
        if (isNaN(maxBitrate) || !streamProcessorDict[type]) {
            return idx;
        }
        var maxIdx = getQualityForBitrate(streamProcessorDict[type].getMediaInfo(), maxBitrate);
        return Math.min (idx , maxIdx);
    }

    function checkMaxRepresentationRatio(idx, type, maxIdx) {
        var maxRepresentationRatio = getMaxAllowedRepresentationRatioFor(type);
        if (isNaN(maxRepresentationRatio) || maxRepresentationRatio >= 1 || maxRepresentationRatio < 0) {
            return idx;
        }
        return Math.min( idx , Math.round(maxIdx * maxRepresentationRatio) );
    }

    function checkPortalSize(idx, type) {
        if (type !== 'video' || !limitBitrateByPortal || !streamProcessorDict[type]) {
            return idx;
        }

        var hasPixelRatio = usePixelRatioInLimitBitrateByPortal && window.hasOwnProperty('devicePixelRatio');
        var pixelRatio = hasPixelRatio ? window.devicePixelRatio : 1;
        var element = videoModel.getElement();
        var elementWidth = element.clientWidth * pixelRatio;
        var elementHeight = element.clientHeight * pixelRatio;
        var manifest = manifestModel.getValue();
        var representation = dashManifestModel.getAdaptationForType(manifest, 0, type).Representation;
        var newIdx = idx;

        if (elementWidth > 0 && elementHeight > 0) {
            while (
                newIdx > 0 &&
                representation[newIdx] &&
                elementWidth < representation[newIdx].width &&
                elementWidth - representation[newIdx - 1].width < representation[newIdx].width - elementWidth
            ) {
                newIdx = newIdx - 1;
            }

            if (representation.length - 2 >= newIdx && representation[newIdx].width === representation[newIdx + 1].width) {
                newIdx = Math.min(idx, newIdx + 1);
            }
        }

        return newIdx;
    }

    function onFragmentLoadProgress(e) {
        const type = e.request.mediaType;
        if (getAutoSwitchBitrateFor(type)) {

            const rules = abrRulesCollection.getRules(ABRRulesCollection.ABANDON_FRAGMENT_RULES);
            const scheduleController = streamProcessorDict[type].getScheduleController();
            if (!scheduleController) return;// There may be a fragment load in progress when we switch periods and recreated some controllers.

            const callback = function (switchRequest) {
                if (switchRequest.confidence === SwitchRequest.STRONG &&
                    switchRequest.value < getQualityFor(type, streamController.getActiveStreamInfo())) {

                    const fragmentModel = scheduleController.getFragmentModel();
                    const request = fragmentModel.getRequests({state: FragmentModel.FRAGMENT_MODEL_LOADING, index: e.request.index})[0];
                    if (request) {
                        //TODO Check if we should abort or if better to finish download. check bytesLoaded/Total
                        fragmentModel.abortRequests();
                        setAbandonmentStateFor(type, ABANDON_LOAD);
                        setPlaybackQuality(type, streamController.getActiveStreamInfo(), switchRequest.value, switchRequest.reason);
                        eventBus.trigger(Events.FRAGMENT_LOADING_ABANDONED, {streamProcessor: streamProcessorDict[type], request: request, mediaType: type});

                        clearTimeout(abandonmentTimeout);
                        abandonmentTimeout = setTimeout(() => {
                            setAbandonmentStateFor(type, ALLOW_LOAD);
                            abandonmentTimeout = null;
                        }, mediaPlayerModel.getAbandonLoadTimeout());
                    }
                }
            };

            rulesController.applyRules(rules, streamProcessorDict[type], callback, e, function (currentValue, newValue) {
                return newValue;
            });
        }
    }

    instance = {
        isPlayingAtTopQuality: isPlayingAtTopQuality,
        updateTopQualityIndex: updateTopQualityIndex,
        getAverageThroughput: getAverageThroughput,
        getBitrateList: getBitrateList,
        getQualityForBitrate: getQualityForBitrate,
        getMaxAllowedBitrateFor: getMaxAllowedBitrateFor,
        setMaxAllowedBitrateFor: setMaxAllowedBitrateFor,
        getMaxAllowedRepresentationRatioFor: getMaxAllowedRepresentationRatioFor,
        setMaxAllowedRepresentationRatioFor: setMaxAllowedRepresentationRatioFor,
        getInitialBitrateFor: getInitialBitrateFor,
        setInitialBitrateFor: setInitialBitrateFor,
        getInitialRepresentationRatioFor: getInitialRepresentationRatioFor,
        setInitialRepresentationRatioFor: setInitialRepresentationRatioFor,
        setAutoSwitchBitrateFor: setAutoSwitchBitrateFor,
        getAutoSwitchBitrateFor: getAutoSwitchBitrateFor,
        setLimitBitrateByPortal: setLimitBitrateByPortal,
        getLimitBitrateByPortal: getLimitBitrateByPortal,
        getUsePixelRatioInLimitBitrateByPortal: getUsePixelRatioInLimitBitrateByPortal,
        setUsePixelRatioInLimitBitrateByPortal: setUsePixelRatioInLimitBitrateByPortal,
        getConfidenceFor: getConfidenceFor,
        getQualityFor: getQualityFor,
        getAbandonmentStateFor: getAbandonmentStateFor,
        setAbandonmentStateFor: setAbandonmentStateFor,
        setPlaybackQuality: setPlaybackQuality,
        setAbrAlgorithm: setAbrAlgorithm,
        getPlaybackQuality: getPlaybackQuality,
        setAverageThroughput: setAverageThroughput,
        getTopQualityIndexFor: getTopQualityIndexFor,
        initialize: initialize,
        setConfig: setConfig,
        reset: reset
    };

    setup();

    return instance;
}

AbrController.__dashjs_factory_name = 'AbrController';
let factory = FactoryMaker.getSingletonFactory(AbrController);
factory.ABANDON_LOAD = ABANDON_LOAD;
factory.QUALITY_DEFAULT = QUALITY_DEFAULT;
export default factory;
