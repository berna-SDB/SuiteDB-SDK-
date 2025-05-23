/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
**/

define(['N/log', 'N/runtime', 'N/search', 'N/file', 'N/record', 'N/redirect', 'N/config', 'N/render', 'N/format', 'N/email', 'N/url', 'N/query', 'N/config', 'N/ui/serverWidget', 'N/xml', 'N/currency', 'N/https'], //BSMX-380.n //BMS-649.n //BMS-706.n
    function (log, runtime, search, file, record, redirect, config, render, nformat, email, url, query, config, serverWidget, xml, currency, https) { //BSMX-380.n //BMS-649.n //BMS-706.n
        var md = 'MX-LOCALIZATIONS-LIB -> ';
        var cfdiStatus = {
            stamped: 1,
            appToStamp: 2,
            cancelled: 3,
            stampError: 4
        }

        //Ejecuta una búsqueda usando el módulo N/query y devuelve una lista de cuentas (ACCOUNT) con algunos campos específicos.
        function reconcileAccountS() {
            try {
                var accountQuery = query.create({ type: query.Type.ACCOUNT });

                var CreateColumQuery = function (fieldID) {
                    return accountQuery.createColumn({ fieldId: fieldID });
                }
                accountQuery.columns = [CreateColumQuery('id'),
                CreateColumQuery('reconcilewithmatching'),
                CreateColumQuery('sspecacct')];

                return queryResults = accountQuery.run().results;

            } catch (e) {
                log.error("Error reconcileAccountS", e);
            }
        }

        //Registra una excepción completa (con detalles del archivo XML, líneas, headers)
        //Analiza errores específicos para manejar reintentos
        //Redirige al usuario a la excepción generada
        function createException(exceptionObj, fileId, fieldCheck) {
            var fn = '/createException';
            var exceptionId = null;
            var exceptionRec = record.create({
                type: 'customrecord_bit_fact_e_exceptions',
                isDynamic: false
            });

            exceptionRec.setValue({ fieldId: 'custrecord_bit_fact_e_exc_proc_phase', value: exceptionObj.phaseProcess });
            exceptionRec.setValue({ fieldId: 'custrecord_bit_fact_e_exc_transaction', value: parseInt(exceptionObj.recordId) });
            exceptionRec.setValue({ fieldId: 'custrecord_bit_fact_e_exc_exception_flag', value: true });
            exceptionRec.setValue({ fieldId: 'custrecord_bit_fact_e_exc_excep_details', value: exceptionObj.exceptionMessage });

            if (notEmpty(exceptionObj.lines) && exceptionObj.lines.length >= 1 && fileId != -1) {

                var headerMssg = exceptionObj.header.toString() ? exceptionObj.header.toString() : '';
                exceptionRec.setValue({ fieldId: 'custrecord_bit_fact_e_exc_header', value: headerMssg });
                exceptionRec.setValue({ fieldId: 'custrecord_bit_fact_e_exc_xml_file', value: fileId });
                exceptionRec.setValue({ fieldId: 'custrecord_bit_fact_e_exc_lines_details', value: exceptionObj.lines.toString() });
                exceptionId = exceptionRec.save({
                    enableSourcing: true,
                    ignoreMandatoryFields: true
                });

            } else if (notEmpty(exceptionObj.header) && fileId != -1) {

                exceptionRec.setValue({ fieldId: 'custrecord_bit_fact_e_exc_header', value: exceptionObj.header.toString() });
                exceptionRec.setValue({ fieldId: 'custrecord_bit_fact_e_exc_xml_file', value: fileId });
                exceptionId = exceptionRec.save({
                    enableSourcing: true,
                    ignoreMandatoryFields: true
                });

            } else if (fileId != -1) {

                exceptionRec.setValue({ fieldId: 'custrecord_bit_fact_e_exc_xml_file', value: fileId });
                exceptionId = exceptionRec.save({
                    enableSourcing: true,
                    ignoreMandatoryFields: true
                });

            } else {

                exceptionId = exceptionRec.save({
                    enableSourcing: true,
                    ignoreMandatoryFields: true
                });

            }

            var valuesToSub = {};
            valuesToSub[fieldCheck] = true;
            valuesToSub["custbody_bit_fe_timbrado_in_progress"] = false;
            if (exceptionObj && exceptionObj.exceptionMessage) {
                var exceptionMessageStr = String(exceptionObj.exceptionMessage);
                if (exceptionMessageStr.indexOf('Exception Details. :') !== -1) {
                    try {
                        var jsonString = exceptionMessageStr.replace('Exception Details. :', '');
                        var exceptionObject = JSON.parse(jsonString);
                        if (exceptionObject.name === 'SSS_REQUEST_TIME_EXCEEDED') {
                            valuesToSub["custbody_bit_fe_timbrado_in_progress"] = true;
                        }
                    } catch (error) {
                        log.error('Error parsing JSON:', error);
                    }
                }
            }
            if (exceptionObj.recordType && exceptionObj.recordId) {
                var transactionFields = search.lookupFields({ 
                    type: exceptionObj.recordType,
                    id: exceptionObj.recordId,
                    columns: ['custbody_bit_fact_e_uuid_folio_fiscal']
                });
                log.audit('FolioFiscal exception', transactionFields.custbody_bit_fact_e_uuid_folio_fiscal);
                if ((!transactionFields && !transactionFields.custbody_bit_fact_e_uuid_folio_fiscal) || exceptionObj.tower) {
                    valuesToSub["custbody_bit_mx_loc_cfdi_status"] = cfdiStatus.stampError;
                }
            }

            record.submitFields({
                type: exceptionObj.recordType,
                id: exceptionObj.recordId,
                values: valuesToSub,
                options: {
                    enableSourcing: false,
                    ignoreMandatoryFields: true
                }
            });

            log.audit({
                title: md + fn + ': LOG',
                details: 'Process: DONE'
            });

            redirect.toRecord({
                type: 'customrecord_bit_fact_e_exceptions',
                id: exceptionId
            });
        }

        //Convierte una hora en formato de 12 horas (AM/PM) a formato de 24 horas.
        function convertTo24Hour(time) {
            var hours = time.split(':')[0];
            if (time.indexOf('am') != -1 && hours == 12) {
                time = time.replace('12', '00');
            }
            if (time.indexOf('pm') != -1 && hours < 12) {
                time = time.replace(hours, (Number(hours) + 12));
            }
            else if (time.indexOf('am') != -1 && hours < 10) {
                hours = "0" + hours;
                var min = time.split(':')[1];
                var sec = time.split(':')[2];

                time = hours + ':' + min + ':' + sec;
            }
            return time.replace(/(am|pm)/, '');
        }


        //construye una fecha con hora en formato ISO 8601 (YYYY-MM-DDTHH:mm:ss) tomando en cuenta el formato de fecha del usuario o sistema, 
        // la zona horaria de una ubicación (location) y una hora opcional (timeExpedition).
        //Genera una cadena de fecha y hora exacta, formateada correctamente.
        function setDateTimeFormat(date, locationId, timeExpedition) {
            var fn = 'main/setDateTimeFormat';
            log.debug({
                title: fn + ': LOG: DATE',
                details: date
            });

            var currentDate = new Date();

            var timeZoneUser = '';

            var zipCodeLocation = '';
            if (locationId) {
                var timeZoneLocation = search.lookupFields({
                    type: search.Type.LOCATION,
                    id: locationId,
                    columns: ['timezone', 'zip']
                });

                timeZoneUser = timeZoneLocation.timezone[0] ? timeZoneLocation.timezone[0].value : '';
                zipCodeLocation = timeZoneLocation ? timeZoneLocation.zip : ''
            }

            if (!zipCodeLocation || !timeZoneUser) {
                var recConfig = config.load({ type: config.Type.USER_PREFERENCES });
                timeZoneUser = recConfig.getValue({ fieldId: 'TIMEZONE' });
            }

            var currentDateZone = nformat.format({
                value: currentDate,
                type: nformat.Type.DATETIME,
                timezone: timeZoneUser
            });

            var splitTimeDate = currentDateZone.split(" "); 
            var timeZn = splitTimeDate[1] + splitTimeDate[2];
            //var timeConvert = convertTo24Hour(timeZn); //BSMX-53.en //BMS-561.o
            var timeConvert = timeExpedition ? timeExpedition : convertTo24Hour(timeZn);
            log.debug('timeConvert', timeConvert);

            /*currentDate = new Date(currentDate)//SPRINT/15.en //BSMX-53.so
            var min = currentDate.getMinutes() < 10 ? '0' + currentDate.getMinutes() : currentDate.getMinutes();
            var hrs = currentDate.getHours(); */ //BSMX-53.eo

            /*if(hrs > 12)
                hrs = hrs - 12;*/ //SPRINT/15.o

            /*if(hrs < 10) //BSMX-53.so
                hrs = '0' + hrs;
    
            var sec = currentDate.getSeconds() < 10 ? '0' + currentDate.getSeconds() : currentDate.getSeconds();*/ //BSMX-53.eo

            var dateFormatObj = dateFormat();
            var format = dateFormatObj.dateFormat;
            var splitSignal = dateFormatObj.splitSignal;
            var dayPosition = dateFormatObj.dayPosition;
            var daySignal = dateFormatObj.daySignal;
            var monthPosition = dateFormatObj.monthPosition;
            var monthSignal = dateFormatObj.monthSignal;
            var yearPosition = dateFormatObj.yearPosition;

            var dateSplit = date.toString().split(splitSignal);

            var monthValue = dateSplit[monthPosition];
            //var monthValueInt = Number(monthValue); //BSMX-296.o
            var monthValueInt = parseInt(monthValue, 10);
            if (isNaN(monthValueInt))
                monthValueInt = months(monthSignal, monthValue);

            var day = dateSplit[dayPosition];
            var dayInt = Number(day);

            var yyyy = dateSplit[yearPosition];
            var mm = monthValueInt < 10 ? '0' + monthValueInt : monthValueInt;
            var dd = dayInt < 10 ? '0' + dayInt : dayInt;

            //var dateTime = yyyy + '-' + mm + '-' + dd + 'T'+ hrs + ':' + min + ':' + sec; //BSMX-53.o
            var dateTime = yyyy + '-' + mm + '-' + dd + 'T' + timeConvert;
            log.debug({
                title: fn + ': LOG: DATE_TIME',
                details: dateTime
            });

            return dateTime;
        }

        //Analiza y devuelve la estructura del formato de fecha configurado en las preferencias del usuario en NetSuite.
        function dateFormat() {
            var fn = 'main/dateFormat';
            var recConfig = config.load({
                type: config.Type.USER_PREFERENCES
            });
            log.debug({
                title: fn + ': LOG: recConfig',
                details: recConfig
            });
            var dateFormat = recConfig.getValue({ fieldId: 'DATEFORMAT' });

            var splitSignalArr = ['/', '-', '.', ' ', ','];
            var daySignalArr = ['D', 'DD'];
            var monthSignalArr = ['M', 'MM', 'MONTH', 'MONTH,', 'Mon'];
            var yearSignalArr = ['YYYY'];

            var dateStr = dateFormat.toString();

            var splitSignal = null;
            var dayPosition = null;
            var monthPosition = null;
            var yearPosition = null;

            var monthSignal = null;
            var daySignal = null;

            for (var i = 0; i < splitSignalArr.length; i++) {
                var dateSplit = dateStr.split(splitSignalArr[i]);
                if (dateSplit.length == 3) {
                    splitSignal = splitSignalArr[i];

                    for (var d = 0; d < daySignalArr.length; d++) {
                        var findDay = dateSplit.indexOf(daySignalArr[d]);
                        if (findDay != -1) {
                            dayPosition = findDay;
                            daySignal = daySignalArr[d];
                        }
                    }

                    for (var m = 0; m < monthSignalArr.length; m++) {
                        var findMonth = dateSplit.indexOf(monthSignalArr[m]);
                        if (findMonth != -1) {
                            monthPosition = findMonth;
                            monthSignal = monthSignalArr[m];
                        }
                    }

                    for (var y = 0; y < yearSignalArr.length; y++) {
                        var findYear = dateSplit.indexOf(yearSignalArr[y]);
                        if (findYear != -1)
                            yearPosition = findYear;
                    }
                    break;
                }
            }

            var dateStructureObj = {};
            dateStructureObj.dateFormat = dateFormat;
            dateStructureObj.splitSignal = splitSignal;
            dateStructureObj.dayPosition = dayPosition;
            dateStructureObj.daySignal = daySignal;
            dateStructureObj.monthPosition = monthPosition;
            dateStructureObj.monthSignal = monthSignal;
            dateStructureObj.yearPosition = yearPosition;

            log.debug({
                title: fn + ': LOG: DATE_OBJECT',
                details: JSON.stringify(dateStructureObj)
            });

            return dateStructureObj;
        }

        //Convierte un mes en formato texto a su número correspondiente (convertir "Feb" o "February" en 2).
        function months(monthSignal, monthValue) {
            var monthsObj = {};
            monthsObj[1] = (monthSignal == 'MONTH,' || monthSignal == 'MONTH') ? 'January' : 'Jan';
            monthsObj[2] = (monthSignal == 'MONTH,' || monthSignal == 'MONTH') ? 'Febuary' : 'Feb';
            monthsObj[3] = (monthSignal == 'MONTH,' || monthSignal == 'MONTH') ? 'March' : 'Mar';
            monthsObj[4] = (monthSignal == 'MONTH,' || monthSignal == 'MONTH') ? 'April' : 'Apr';
            monthsObj[5] = (monthSignal == 'MONTH,' || monthSignal == 'MONTH') ? 'May' : 'May';
            monthsObj[6] = (monthSignal == 'MONTH,' || monthSignal == 'MONTH') ? 'June' : 'Jun';
            monthsObj[7] = (monthSignal == 'MONTH,' || monthSignal == 'MONTH') ? 'July' : 'Jul';
            monthsObj[8] = (monthSignal == 'MONTH,' || monthSignal == 'MONTH') ? 'August' : 'Aug';
            monthsObj[9] = (monthSignal == 'MONTH,' || monthSignal == 'MONTH') ? 'September' : 'Sep';
            monthsObj[10] = (monthSignal == 'MONTH,' || monthSignal == 'MONTH') ? 'October' : 'Oct';
            monthsObj[11] = (monthSignal == 'MONTH,' || monthSignal == 'MONTH') ? 'November' : 'Nov';
            monthsObj[12] = (monthSignal == 'MONTH,' || monthSignal == 'MONTH') ? 'December' : 'Dec';

            for (var i in monthsObj) {
                var value = monthsObj[i];
                if (value == monthValue) {
                    return parseInt(i);
                }
            }
        }

        //Obtiene el número de documento de una transacción, ya sea el número de transacción estándar (tranid) o un número personalizado (custbody_bit_fact_e_folio), dependiendo del tipo de registro.
        function getRecordDocNo(recordType, recordId) {
            var docNum = "";

            var tranLU = search.lookupFields({
                type: recordType,
                id: parseInt(recordId),
                columns: ['tranid', 'custbody_bit_fact_e_folio']
            });

            docNum = tranLU && tranLU.tranid ? tranLU.tranid : "";
            /*if(recordType == 'invoice') { //BSMX-125.sn
                docNum = tranLU && tranLU.tranid ? tranLU.tranid : "";
            } else {
                docNum = tranLU && tranLU.custbody_bit_fact_e_folio ? tranLU.custbody_bit_fact_e_folio : "";
            }*/ //BSMX-125.en

            return docNum;
        }
        //Reemplaza valores dentro del contenido XML recorriendo el objeto xmlReplace, que contiene pares clave/valor.
        function replaceData(xmlFileContent, xmlReplace) {
            for (var x in xmlReplace) {
                xmlFileContent = xmlFileContent.replace(x, xmlReplace[x]);
            }
            return xmlFileContent;
        }
        //Detecta claves en xmlReplace que no fueron reemplazadas (es decir, su valor es igual a la clave). Agrega esas claves a un arreglo y lo devuelve.
        function getMissingFields(xmlReplace) {
            var missingValuesArr = [];

            for (var y in xmlReplace) {
                if (y == xmlReplace[y])
                    missingValuesArr.push(xmlReplace[y]);
            }

            return missingValuesArr;
        }

        //Crea un archivo XML en el File Cabinet de NetSuite.
        function createFile(content, xmlFileName, folderId) {
            var renderer = render.create();
            renderer.templateContent = content;
            var xmlContent = renderer.renderAsString();

            var xmlFileContentObj = file.create({
                name: xmlFileName,
                fileType: file.Type.XMLDOC,
                contents: xmlContent,
                encoding: file.Encoding.UTF8,
                folder: folderId,
                isOnline: false
            });

            return xmlFileContentObj.save();
        }
        //Elimina de la cadena secuencia los datos que no fueron reemplazados.
        //Para cada valor en missingDataFound, busca su posición en la cadena secuencia. Si lo encuentra, elimina ese valor junto con un pipe (|).
        function removeMissingData(secuencia, missingDataFound) {
            for (var i = 0; i < missingDataFound.length; i++) {
                var dataIndex = secuencia.indexOf(missingDataFound[i]);
                if (dataIndex != -1) {
                    var removeData = missingDataFound[i] + '|';
                    var dataEndIndex = dataIndex + removeData.length;
                    var removeStart = secuencia.substring(0, dataIndex);
                    var removeEnd = secuencia.substring(dataEndIndex, secuencia.length);

                    secuencia = removeStart + removeEnd;
                }
            }
            return secuencia;
        }

        //Reemplaza todos los casos de || (doble pipe) por un solo |, dentro de una cadena de texto.
        function removeDoblePipes(content) {
            var replacePipe = {};
            replacePipe['||'] = '|';

            var splitContent = content.split('||');
            for (var i = 0; splitContent.length > 0 && i < splitContent.length; i++) {
                content = replaceData(content, replacePipe);
            }
            return content;
        }

        //Obtiene la tasa de cambio (exchange rate) de un registro de transacción en NetSuite. Toma el valor del campo exchangerate del 
        // registro (record) recibido como parámetro. Lo convierte en número y lo devuelve.
        function getExchangeRate(record) {

            var exchangeRec = record.getValue({ fieldId: 'exchangerate' });
            return Number(exchangeRec);
        }


        //Formatea un número decimal con una cantidad específica de decimales. Si el valor es un número, lo formatea con 2 decimales por defecto.
        function fmtDec(number, decimals) {
            var parseNum = number;
            if (typeof parseNum != 'number') {
                parseNum = Number(number);
            }
            if (isNaN(parseNum)) {
                parseNum = number;
            } else {
                decimals = decimals ? decimals : 2;
                parseNum = parseNum.toFixed(decimals);
            }
            return parseNum;
        }

        //Verifica si el entorno en el que se está ejecutando el script es testing.
        function isTesting() {
            return runtime.envType != 'PRODUCTION';
        }

        //Verifica si el valor que se pasa por parametro es null, vacio, undefined, false, etc.
        function isEmpty(val) {
            return (val === null || val === '' || val === 'null' || val === 'undefined' || val === undefined || val === false || val.length === 0);
        }

        //Verifica si la variable que se pasa por parametro es vacia llamando a la funcion anterior (isEmpty)
        function notEmpty(tmp) {
            return !isEmpty(tmp);
        }

        //Verifica si la variale es null
        function isNull(val) {
            return (val == null || val == 'null');
        }

        //Verifica si la variable no es null
        function notNull(tmp) {
            return !isNull(tmp);
        }

        //Genera la fecha actual (todayDate) formateada según la preferencia de formato de fecha configurada por el usuario en NetSuite.
        function formatTodayDate() {	
            var recConfig = config.load({
                type: config.Type.USER_PREFERENCES
            });
            log.debug({
                title: 'LOG: recConfig',
                details: recConfig
            });
            var dateFormat = recConfig.getValue({ fieldId: 'DATEFORMAT' });

            var dateStr = dateFormat.toString();
            dateStr = dateStr.substring(0, 1);
            log.debug({
                title: 'LOG: dateStr',
                details: dateStr
            });
            var formatDateFirst = (dateStr == 'D') ? true : false;
            log.debug({
                title: 'LOG: formatDateFirst',
                details: formatDateFirst
            });

            var todayDate = new Date();
            if (formatDateFirst)
                todayDate = todayDate.getDate() + '/' + (todayDate.getMonth() + 1) + '/' + todayDate.getFullYear();
            else
                todayDate = (todayDate.getMonth() + 1) + '/' + todayDate.getDate() + '/' + todayDate.getFullYear();

            return todayDate
        }

        //Realiza una búsqueda (search) en NetSuite para obtener información sobre uno o varios deploys
        function getScriptDeployment(deploymentId) {
            var sFilter = [];

            if (deploymentId) {
                sFilter = [
                    ["scriptid", "is", deploymentId]
                ]
            }
            else {
                sFilter = [
                    ["script.isinactive", "is", "F"],
                    "AND",
                    ["script.scripttype", "anyof", "SCRIPTLET"]
                ]
            }

            var scriptDeploymentSearchObj = search.create({
                type: "scriptdeployment",
                filters: sFilter,
                columns:
                    [
                        search.createColumn({ name: "title", sort: search.Sort.ASC, label: "Title" }),
                        search.createColumn({ name: "internalid", label: "Internal ID" }),
                        search.createColumn({ name: "script", label: "Script ID" }),
                        search.createColumn({ name: "scriptid", label: "Custom ID" }),
                        search.createColumn({ name: "scriptid", join: "script", label: "Script ID" }),
                        search.createColumn({ name: "status", label: "Status" })
                    ]
            });

            var searchResultCount = scriptDeploymentSearchObj.runPaged().count;
            var searchResult = scriptDeploymentSearchObj.run().getRange(0, 1000);

            return searchResult;
        }

        //Devuelve cuántos decimales tiene un número, con un límite máximo de 6, pero si tiene más, retorna 2 por defecto.
        function getLengthDecimals(number) {
            var numberSplit = number ? number.toString().split('.') : 0;
            var lengthDecimals = numberSplit.length && numberSplit.length > 1 ? numberSplit[1].length : 2;
            return lengthDecimals > 6 ? 2 : lengthDecimals;
        }

        //Limpia un texto eliminando caracteres especiales y normaliza espacios.
        function removeSpecialCharacters(text) {
            //return  text.replace(/&lt;|&gt;|<|>|&|"|'|\|/g,'').replace(/[ ]+/g,' ').trim(); //SPRINT/19.o
            return text.replace(/&lt;|&gt;|<|>|&|"|'|\|/g, '').replace(/[\s]+/g, ' ').trim(); //SPRINT/19.n
        }

        //Función para ejecutar una búsqueda (search) de forma dinámica, ya sea cargando una búsqueda guardada (Saved Search) o creando una búsqueda desde cero, con filtros, columnas y configuraciones opcionales.
        function loadSearch(stRecordType, stSearchId, arrSearchFilter, arrSearchColumn, arrSettings) { 
            if (stRecordType == null && stSearchId == null) {
                throw {
                    name: "SSS_MISSING_REQD_ARGUMENT",
                    message:
                        "Missing a required argument. Either stRecordType or stSearchId should be provided.",
                    notifyOff: false
                };
            }

            var arrReturnSearchResults = [];
            var objSavedSearch;

            var maxResults = 1000;

            if (stSearchId != null) {
                objSavedSearch = search.load({
                    id: stSearchId
                });

                // add search filter if one is passed
                if (arrSearchFilter != null) {
                    if (
                        arrSearchFilter[0] instanceof Array ||
                        typeof arrSearchFilter[0] == "string"
                    ) {
                        objSavedSearch.filterExpression = objSavedSearch.filterExpression.concat(
                            arrSearchFilter
                        );
                    } else {
                        objSavedSearch.filters = objSavedSearch.filters.concat(
                            arrSearchFilter
                        );
                    }
                }

                // add search column if one is passed
                if (arrSearchColumn != null) {
                    objSavedSearch.columns = objSavedSearch.columns.concat(
                        arrSearchColumn
                    );
                }
            } else {
                objSavedSearch = search.create({
                    type: stRecordType
                });

                // add search filter if one is passed
                if (arrSearchFilter != null) {
                    if (
                        arrSearchFilter[0] instanceof Array ||
                        typeof arrSearchFilter[0] == "string"
                    ) {
                        objSavedSearch.filterExpression = arrSearchFilter;
                    } else {
                        objSavedSearch.filters = arrSearchFilter;
                    }
                }

                // add search column if one is passed
                if (arrSearchColumn != null) {
                    objSavedSearch.columns = arrSearchColumn;
                }

                if (arrSettings != null) {
                    objSavedSearch.settings = arrSettings;
                }
            }

            var objResultset = objSavedSearch.run();
            var intSearchIndex = 0;
            var arrResultSlice = null;
            do {
                arrResultSlice = objResultset.getRange(
                    intSearchIndex,
                    intSearchIndex + maxResults
                );
                if (arrResultSlice == null) {
                    break;
                }

                arrReturnSearchResults = arrReturnSearchResults.concat(arrResultSlice);
                intSearchIndex = arrReturnSearchResults.length;
            } while (arrResultSlice.length >= maxResults);

            return arrReturnSearchResults;
        }

        //Toma como parámetro un número entero del 1 al 9 y devuelve su equivalente en letras
        function Unidades(num) {

            switch (num) {
                case 1:
                    return 'UN';
                case 2:
                    return 'DOS';
                case 3:
                    return 'TRES';
                case 4:
                    return 'CUATRO';
                case 5:
                    return 'CINCO';
                case 6:
                    return 'SEIS';
                case 7:
                    return 'SIETE';
                case 8:
                    return 'OCHO';
                case 9:
                    return 'NUEVE';
            }

            return '';
        }

        //Convierte un número entre 0 y 99 a su representación en texto
        function Decenas(num) {

            decena = Math.floor(num / 10);
            unidad = num - (decena * 10);

            switch (decena) {
                case 1:
                    switch (unidad) {
                        case 0:
                            return 'DIEZ';
                        case 1:
                            return 'ONCE';
                        case 2:
                            return 'DOCE';
                        case 3:
                            return 'TRECE';
                        case 4:
                            return 'CATORCE';
                        case 5:
                            return 'QUINCE';
                        default:
                            return 'DIECI' + Unidades(unidad);
                    }
                case 2:
                    switch (unidad) {
                        case 0:
                            return 'VEINTE';
                        default:
                            return 'VEINTI' + Unidades(unidad);
                    }
                case 3:
                    return DecenasY('TREINTA', unidad);
                case 4:
                    return DecenasY('CUARENTA', unidad);
                case 5:
                    return DecenasY('CINCUENTA', unidad);
                case 6:
                    return DecenasY('SESENTA', unidad);
                case 7:
                    return DecenasY('SETENTA', unidad);
                case 8:
                    return DecenasY('OCHENTA', unidad);
                case 9:
                    return DecenasY('NOVENTA', unidad);
                case 0:
                    return Unidades(unidad);
            }
        }

        function DecenasY(strSin, numUnidades) {
            if (numUnidades > 0)
                return strSin + ' Y ' + Unidades(numUnidades)

            return strSin;
        }

        function Centenas(num) {
            centenas = Math.floor(num / 100);
            decenas = num - (centenas * 100);

            switch (centenas) {
                case 1:
                    if (decenas > 0)
                        return 'CIENTO ' + Decenas(decenas);
                    return 'CIEN';
                case 2:
                    return 'DOSCIENTOS ' + Decenas(decenas);
                case 3:
                    return 'TRESCIENTOS ' + Decenas(decenas);
                case 4:
                    return 'CUATROCIENTOS ' + Decenas(decenas);
                case 5:
                    return 'QUINIENTOS ' + Decenas(decenas);
                case 6:
                    return 'SEISCIENTOS ' + Decenas(decenas);
                case 7:
                    return 'SETECIENTOS ' + Decenas(decenas);
                case 8:
                    return 'OCHOCIENTOS ' + Decenas(decenas);
                case 9:
                    return 'NOVECIENTOS ' + Decenas(decenas);
            }

            return Decenas(decenas);
        }

        //Convierte números a texto.
        function Seccion(num, divisor, strSingular, strPlural) {
            cientos = Math.floor(num / divisor)
            resto = num - (cientos * divisor)

            letras = '';

            if (cientos > 0)
                if (cientos > 1)
                    letras = Centenas(cientos) + ' ' + strPlural;
                else
                    letras = strSingular;

            if (resto > 0)
                letras += '';

            return letras;
        }

        //Convierte números a texto.
        function Miles(num) {
            divisor = 1000;
            cientos = Math.floor(num / divisor)
            resto = num - (cientos * divisor)

            strMiles = Seccion(num, divisor, 'UN MIL', 'MIL');
            strCentenas = Centenas(resto);

            if (strMiles == '')
                return strCentenas;

            return strMiles + ' ' + strCentenas;
        }//Miles()

        //Convierte números a texto.
        function Millones(num) {
            divisor = 1000000;
            cientos = Math.floor(num / divisor)
            resto = num - (cientos * divisor)

            strMillones = Seccion(num, divisor, 'UN MILLON DE', 'MILLONES DE');
            strMiles = Miles(resto);

            if (strMillones == '')
                return strMiles;

            return strMillones + ' ' + strMiles;
        }//Millones()

        //convierte un número decimal en texto en español, indicando la cantidad con letras y los centavos e incluye el tipo de moneda (como PESOS).
        function numberToWords(num, isoCodecurrency) {
            var data = {
                numero: num,
                enteros: Math.floor(num),
                centavos: (((Math.round(num * 100)) - (Math.floor(num) * 100))),
                currency: isoCodecurrency,
                letrasCentavos: '',
                letrasMonedaFinal: 'M.N.',
                letrasMonedaPlural: 'PESOS',
                letrasMonedaSingular: 'PESO',
                //letrasMonedaCentavoPlural: 'CENTAVOS',
                //letrasMonedaCentavoSingular: 'CENTAVO'
            };

            if (data.currency == "usd") {
                data.letrasMonedaPlural = "DÓLARES";
                data.letrasMonedaSingular = "DOLAR";
                data.letrasMonedaFinal = "USD";//DT-1412.n
            }

            if (data.centavos.length > 2) {
                if (data.centavos.substring(2, 3) >= 5)
                    centavos = data.centavos.substring(0, 1) + (parseInt(data.centavos.substring(1, 2)) + 1).toString();
                else
                    centavos = data.centavos.substring(0, 1);
            }

            /* Concatena a los centavos la cadena "/100"*/
            if (data.centavos.length == 1) {
                data.letrasCentavos = data.centavos + "0";
            }
            data.letrasCentavos = data.centavos + "/100";

            /*if (data.centavos > 0) {
                data.letrasCentavos = 'CON ' + (function (){
                    if (data.centavos == 1)
                        return Millones(data.centavos) + ' ' + data.letrasMonedaCentavoSingular;
                    else
                        return Millones(data.centavos) + ' ' + data.letrasMonedaCentavoPlural;
                    })();
            }; */

            if (data.enteros == 0)
                return 'CERO ' + data.letrasMonedaPlural + ' ' + data.letrasCentavos;
            if (data.enteros == 1)
                return Millones(data.enteros) + ' ' + data.letrasMonedaSingular + ' ' + data.letrasCentavos + ' ' + data.letrasMonedaFinal;
            else
                return Millones(data.enteros) + ' ' + data.letrasMonedaPlural + ' ' + data.letrasCentavos + ' ' + data.letrasMonedaFinal;
        }

        //Verifica que existan claves esenciales en folders (como xmlTimbrarFolderId, comPagoFolderId, etc.)..
        function searchFolderInConfig(folders) { 
            //var arrFoldersName = ["xmlTimbrarFolderId", "comPagoFolderId", "notaCredFolderId"]; //BSMX-334.o
            var arrFoldersName = ["xmlTimbrarFolderId", "comPagoFolderId", "notaCredFolderId", "itemFulfillFolderId"]; //BSMX-334.n
            var arrSubfoldName = ['xmlFolderId', 'xmlSelladoFolderId', 'exceptionsFolderId', 'requestsFolderId', 'responseFolderId', 'xmlTimbradoFolderId', 'cancelFolderId'];
            var isAddFolder = false;

            arrFoldersName.forEach(function (folderName) {
                var getFolderIdx = folders.indexOf(folderName);
                if (getFolderIdx == -1) {
                    isAddFolder = true;
                }
            });

            arrSubfoldName.forEach(function (subFoldName) {
                var getFolderIdx = folders.indexOf(subFoldName);
                if (getFolderIdx == -1) {
                    isAddFolder = true;
                }
            });

            return isAddFolder;
        }

        //Recibe un objeto con el RFC (Registro Federal de Contribuyentes) de la subsidiaria y devuelve un objeto folderStructure con todos los IDs de carpetas creadas. Crea (si no existen) carpetas base necesarias.
        function createSubsidiaryFolders(configObj) {
            var mainParentFolder = searchFolder('BIT Mexico Localization');
            if (!mainParentFolder) {
                mainParentFolder = createFolder('BIT Mexico Localization', null);
                createFolder('Main Folder', mainParentFolder);
                createFolder('XML Documents', mainParentFolder);
            }
            var mainFolder = searchFolder('Main Folder', mainParentFolder);
            var documentationFolder = searchFolder('XML Documents', mainParentFolder);

            var rfc = configObj.rfc;
            var folderStructure = new Object();

            var subsidiaryFolder = searchFolder(rfc, mainFolder) ? searchFolder(rfc, mainFolder) : createFolder(rfc, mainFolder);
            folderStructure.subsidiaryFolder = subsidiaryFolder;

            var rfcFolderId = searchFolder(rfc, documentationFolder) ? searchFolder(rfc, documentationFolder) : createFolder(rfc, documentationFolder);
            folderStructure.rfcFolderId = rfcFolderId;
            log.debug('rfcFolderId', rfcFolderId);
            var xmlTimbrarFolderId = searchFolder('XML Factura', rfcFolderId) ? searchFolder('XML Factura', rfcFolderId) : createFolder('XML Factura', rfcFolderId);
            folderStructure.xmlTimbrarFolderId = xmlTimbrarFolderId;
            var childTimbradoFolders = setOfFolders(xmlTimbrarFolderId, true, true);
            folderStructure.childTimbradoFolders = childTimbradoFolders;

            /*var cancelFolderId = searchFolder('XML a Cancelar', rfcFolderId) ? searchFolder('XML a Cancelar', rfcFolderId) : createFolder('XML a Cancelar', rfcFolderId);
            folderStructure.cancelFolderId = cancelFolderId;
            var childCancelFolders = setOfFolders(cancelFolderId, false, true);
            folderStructure.childCancelFolders = childCancelFolders;*/

            var comPagoFolderId = searchFolder('XML Complemento de Pago', rfcFolderId) ? searchFolder('XML Complemento de Pago', rfcFolderId) : createFolder('XML Complemento de Pago', rfcFolderId);
            folderStructure.comPagoFolderId = comPagoFolderId;
            var childComPagoFolders = setOfFolders(comPagoFolderId, true, true);
            folderStructure.childComPagoFolders = childComPagoFolders;

            var notaCredFolderId = searchFolder('XML Nota de Credito', rfcFolderId) ? searchFolder('XML Nota de Credito', rfcFolderId) : createFolder('XML Nota de Credito', rfcFolderId);
            folderStructure.notaCredFolderId = notaCredFolderId;
            var childNotaCredFolders = setOfFolders(notaCredFolderId, true, true);
            folderStructure.childNotaCredFolders = childNotaCredFolders;

            var itemFulfillFolderId = searchFolder('XML Item Fulfillment', rfcFolderId) ? searchFolder('XML Item Fulfillment', rfcFolderId) : createFolder('XML Item Fulfillment', rfcFolderId); //BSMX-334.sn
            folderStructure.itemFulfillFolderId = itemFulfillFolderId;
            var childItemFulfillFolders = setOfFolders(itemFulfillFolderId, true, true);
            folderStructure.childItemFulfillFolders = childItemFulfillFolders; //BSMX-334.en

            return folderStructure;
        }

        //Busca un folder
        function searchFolder(name, parent) {
            var objFilters = [];
            objFilters.push(search.createFilter({ name: 'name', operator: search.Operator.IS, values: name }));
            if (parent) {
                objFilters.push(search.createFilter({ name: 'parent', operator: search.Operator.ANYOF, values: parent }));
            }
            var searchObj = search.create({ type: 'folder', filters: objFilters }).run()
            var searchRes = searchObj.getRange(0, 1);
            if (notEmpty(searchRes))
                return searchRes[0].id;
            else
                return null;
        }

        //Crea un folder 
        function createFolder(folderName, folderParent, configId, recordType, setSubFolders) {
            var folder = record.create({ type: 'folder' });
            folder.setValue({ fieldId: 'name', value: folderName });
            if (folderParent) {
                folder.setValue({ fieldId: 'parent', value: folderParent });
            }
            var folderId = folder.save();

            if (setSubFolders) {
                setOfFolders(folderId, true, true, configId, recordType);
            }

            return folderId;
        }

        //Dentro de una carpeta folderId, crea subcarpetas ya definidas en la funcion.
        //Si se pasa recordType y configId, guarda esta estructura en el campo custrecord_mxei_config_folders del registro de configuración personalizado.
        function setOfFolders(folderId, request, response, configId, recordType) {
            log.debug('SetSubfolders', true);
            //var processedFolderId = searchFolder('Processed', folderId) ? searchFolder('Processed', folderId) : createFolder('Processed', folderId);
            var xmlFolderId = searchFolder('XML', folderId) ? searchFolder('XML', folderId) : createFolder('XML', folderId);
            var xmlSelladoFolderId = searchFolder('XML Sellado', folderId) ? searchFolder('XML Sellado', folderId) : createFolder('XML Sellado', folderId);
            var xmlTimbradoFolderId = (response) && searchFolder('XML Timbrado', folderId) ? searchFolder('XML Timbrado', folderId) : createFolder('XML Timbrado', folderId);
            var cancelFolderId = searchFolder('XML Cancelar', folderId) ? searchFolder('XML Cancelar', folderId) : createFolder('XML Cancelar', folderId);
            var requestsFolderId = (request) && searchFolder('Requests', folderId) ? searchFolder('Requests', folderId) : createFolder('Requests', folderId);
            var responseFolderId = (response) && searchFolder('Response', folderId) ? searchFolder('Response', folderId) : createFolder('Response', folderId);
            var exceptionsFolderId = searchFolder('Exceptions', folderId) ? searchFolder('Exceptions', folderId) : createFolder('Exceptions', folderId);

            var foldersObj = new Object();
            foldersObj.xmlFolderId = xmlFolderId;
            foldersObj.xmlSelladoFolderId = xmlSelladoFolderId;
            foldersObj.exceptionsFolderId = exceptionsFolderId;
            foldersObj.requestsFolderId = requestsFolderId;
            foldersObj.responseFolderId = responseFolderId;
            foldersObj.xmlTimbradoFolderId = xmlTimbradoFolderId;
            foldersObj.cancelFolderId = cancelFolderId;

            if (recordType) {
                var configRec = record.load({ type: 'customrecord_bit_mxei_configuration', id: configId });
                var configFolders = configRec.getValue('custrecord_mxei_config_folders');

                switch (recordType) {
                    case 'invoice':
                    case 'customsale_bit_factura_global':
                        configFolders.xmlTimbrarFolderId = folderId;
                        configFolders.childTimbradoFolders = foldersObj;
                        break;
                    case 'creditmemo':
                        configFolders.notaCredFolderId = folderId;
                        configFolders.childNotaCredFolders = foldersObj;
                        break;
                    case 'customerpayment':
                        configFolders.comPagoFolderId = folderId;
                        configFolders.childComPagoFolders = foldersObj;
                        break;
                    case 'itemfulfillment':
                        configFolders.itemFulfillFolderId = folderId;
                        configFolders.childItemFulfillFolders = foldersObj;
                        break;
                }
                configRec.setValue('custrecord_mxei_config_folders', configFolders);
                var recordId = configRec.save();
            }
            log.debug('SubfoldersObj', foldersObj);

            return foldersObj;
        }

        //Verifica un tipo de ítem (como "Discount", "Subtotal", etc.)
        function isItemTypeApp(itemType) { //BSMX-223.sn
            return "Discount|Subtotal|Markup|Payment|Description|Group|EndGroup".indexOf(itemType) == -1;
        }

        //  Remueve caracteres especiales
        function removeSpecialCharactersWtAmp(text) { //BSMX-230.sn
            return text.replace(/&lt;|&gt;|<|>|"|'|\|/g, '').replace(/[\s]+/g, ' ').trim(); //SPRINT/19.n
        } //BSMX-230.en

        //Reemplaza todas las apariciones del carácter & (ampersand) en un texto por su equivalente &amp.
        function escapeAmp(val) {
            return val.replace(/&/g, '&amp;');
        }
        //Reemplaza todas las apariciones del carácter " (ampersand) en un texto por su equivalente &quot.
        function escapeQuot(val) {
            return val.replace(/"/g, '&quot;');
        }

        //Realiza una búsqueda en NetSuite para encontrar un registro activo como un método de pago CFDI, basándose en un valor clave específico.
        function getPagoCfdiDefault(typeRec, field, clave) {
            var searchObj = search.create({
                type: typeRec,
                filters:
                    [
                        ["isinactive", "is", "F"],
                        "AND",
                        [field, "is", clave]
                    ],
                columns:
                    [
                        search.createColumn({
                            name: "name",
                            sort: search.Sort.ASC,
                            label: "Name"
                        }),
                        search.createColumn({ name: field, label: "cat_Clave" })
                    ]
            });
            var searchResultCount = searchObj.runPaged().count;
            log.debug("customrecord_bit_fact_e_metodopagoSearchObj result count", searchResultCount);
            var srchResults = searchObj.run().getRange(0, 1);

            log.debug('srchResults', srchResults);
            log.debug('srchResults id', srchResults.id);

            return srchResults && searchResultCount > 0 ? srchResults[0].id : '';
        }
        
        //Busca un archivo en NetSuite por su nombre y opcionalmente, dentro de una carpeta específica, devuelve su ID interno si lo encuentra.
        function searchFile(name, folder) {
            var objFilters = [];
            objFilters.push(search.createFilter({ name: 'name', operator: search.Operator.IS, values: name }));
            if (folder) {
                objFilters.push(search.createFilter({ name: 'folder', operator: search.Operator.ANYOF, values: folder }));
            }
            var searchObj = search.create({ type: 'file', filters: objFilters }).run()
            var searchRes = searchObj.getRange(0, 1);
            if (notEmpty(searchRes))
                return searchRes[0].id;
            else
                return null;
        }

        //Envía un correo electrónico a un usuario de NetSuite e incluye un link directo al archivo si existe
        function sendEmail(params, user, folderParent) { //BSMX-275.sn
            try {
                var currentUserName = "";
                var fileName = "";
                var urlFile = "";
                var bodyText = "";
                var currentUser = user ? search.lookupFields({ type: search.Type.EMPLOYEE, id: user, columns: ['entityid', 'email'] }) : runtime.getCurrentUser();
                var processType = params;
                log.debug('processTypeSend', processType);
                var userEmail = currentUser.email;
                log.debug('userEmail', userEmail);

                if (processType == "generarPDF") {
                    currentUserName = user ? currentUser && currentUser.entityid ? currentUser.entityid : '' : currentUser.name;
                    fileName = "PDF-" + currentUserName.replace(' ', '') + '.pdf';
                    var searchUserFile = searchFile(fileName, folderParent);
                    if (searchUserFile) {
                        var fileObj = file.load({
                            id: 'BIT Mexico Localization/XML Documents/' + fileName
                        });
                        var scheme = 'https://';
                        var host = url.resolveDomain({
                            hostType: url.HostType.APPLICATION
                        });
                        log.debug('host', host);
                        urlFile = scheme + host + fileObj.url;
                    }

                    bodyText = '<p> Proceso de impresión finalizado. </p><p>PDF:&nbsp;' + urlFile + '</p><p><b> *** POR FAVOR, NO RESPONDA ESTE MENSAJE *** </b></p>';
                }

                if (userEmail != '') {

                    var authorId = user ? user : runtime.getCurrentUser().id;
                    var subjectTxt = 'Generación de PDF';

                    log.debug('authorId', authorId);
                    log.debug('user', user);

                    email.send({
                        author: authorId,
                        recipients: userEmail,
                        subject: subjectTxt,
                        body: bodyText
                    });
                }
            }
            catch (e) {
                log.error('Unexpected error!', e);
            }
        } 

        //Busca un deploy en base a un script 
        function searchDeployment(scriptId) { 

            var scriptSearchObj = search.create({
                type: search.Type.SCRIPT_DEPLOYMENT,
                filters: [["script.scriptid", "startswith", scriptId]],
                columns: ["status"]
            });

            return scriptSearchObj.run().getRange({
                start: 0,
                end: 1
            });
        }

        //Realiza una búsqueda de una o más facturas de ventas (Invoice) en NetSuite utilizando el número interno de documento (internalid) como criterio. 
        //Esta función recupera una serie de datos específicos relacionados con la factura, como totales, moneda, UUID, folio, método de pago, impuestos, etc.
        function getInvoicesData(invoiceDocNo) { 

            var suiteTax = runtime.isFeatureInEffect({ feature: "TAX_OVERHAULING" });
            var sFilter = [];
            sFilter.push(search.createFilter({ name: 'internalid', operator: search.Operator.ANYOF, values: invoiceDocNo }));
            sFilter.push(search.createFilter({ name: 'mainline', operator: search.Operator.IS, values: 'T' }));

            var sColumn = [];
            sColumn.push(search.createColumn({ name: 'tranid' }));
            sColumn.push(search.createColumn({ name: 'custbody_bit_fact_e_uuid_folio_fiscal' }));
            sColumn.push(search.createColumn({ name: 'custbody_bit_fact_e_serie' }));
            sColumn.push(search.createColumn({ name: 'custbody_bit_fact_e_folio' }));
            sColumn.push(search.createColumn({ name: 'symbol', join: 'currency' }));
            sColumn.push(search.createColumn({ name: 'custbody_bit_fact_e_metodopago' }));
            sColumn.push(search.createColumn({ name: 'custbody_bit_pago_numparcialidad' }));
            sColumn.push(search.createColumn({ name: 'custbodybit_fact_e_tipodecambio' }));
            sColumn.push(search.createColumn({ name: 'custbody_bit_fact_e_msg_cancelacion' }));
            sColumn.push(search.createColumn({ name: "custbody_bit_fact_e_totimp_tras" })); //BSMX-392.n
            sColumn.push(search.createColumn({ name: "custbody_bit_fact_e_totimp_ret" })); //BSMX-392.n
            sColumn.push(search.createColumn({ name: "custbody_bit_fact_e_totimp_isr" })); //BMS-619.n
            sColumn.push(search.createColumn({ name: "custbody_bit_aplicar_cce" })); //BSMX-487.n
            if (!suiteTax) {//BMS-760.n
                sColumn.push(search.createColumn({ name: "netamountnotax" })); //BMS-570.n
            }//BMS-760.n
            sColumn.push(search.createColumn({ name: "taxtotal" })); //BMS-576.n
            sColumn.push(search.createColumn({ name: "total" })); //BMS-576.n
            sColumn.push(search.createColumn({ name: "currency" })); //BMS-616.n
            sColumn.push(search.createColumn({ name: "custbody_bit_fe_implocal_aplicar" })); //BMS-656.n

            //var sResults = loadSearch(search.Type.INVOICE, null, sFilter, sColumn); //BMS-651.o
            //BMS-651.sn
            var sSettings = [];
            sSettings.push(search.createSetting({ name: 'consolidationtype', value: 'NONE' }));
            var sResults = loadSearch(search.Type.INVOICE, null, sFilter, sColumn, sSettings);
            //BMS-651.en

            return sResults;
        } //BSMX-279.en


        //Valida el nivel de permiso del rol actual del usuario sobre un tipo específico de transacción (como invoice, creditmemo, etc.) dentro de NetSuite.
        function validatePermissionRole(type) { 

            var permissionRole = '';
            try {
                var rolEmpleoyee = record.load("role", runtime.getCurrentUser().role);

                var permissionCount = rolEmpleoyee.getLineCount({ sublistId: 'tranmach' });
                if (permissionCount != -1) {
                    for (var i = 0; i < permissionCount; i++) {

                        var lineTransaction = record.getSublistValue({ sublistId: 'tranmach', fieldId: 'permkey1', line: i });
                        if (lineTransaction == 'TRAN_' + type.toUpperCase()) {
                            permissionRole = record.getSublistValue({ sublistId: 'tranmach', fieldId: 'permlevel1_display', line: i });
                        }
                    }
                }
            } catch (e) {
                log.error("Error permissionRole", e);
            }
            return permissionRole;
        } 

        //Retorna el simbolo de la moneda que se pasa por parametro
        function getCurrencySymbol(currencyId) { 
            var currencySymbol = search.lookupFields({
                type: search.Type.CURRENCY,
                id: currencyId,
                columns: ['symbol']
            }).symbol;

            return currencySymbol;

        }

        //Obtiene los códigos SAT de países o estados configurados en NetSuite, que son usados en México para cumplir con los requisitos 
        // del SAT (Servicio de Administración Tributaria). Devuelve un array de objetos con los códigos SAT y los códigos correspondientes en NetSuite (NS code) para los registros tipo país o estado.

        function getSatCode(type, codeNS) { 
            var typeSS = '';
            var filterType = '';
            var columnsSS = [];
            var columnSat = '';
            var codeSat = '';

            switch (type) {
                case 'country':
                    typeSS = 'customrecord_mx_sat_countries';
                    columnSat = 'custrecord_mx_sat_cnt_code'

                    columnsSS.push(search.createColumn({ name: 'custrecord_mx_sat_cnt_name' }));
                    columnsSS.push(search.createColumn({ name: columnSat }));
                    columnsSS.push(search.createColumn({ name: 'custrecord_mx_sat_cnt_ns_code' }));

                    filterType = 'custrecord_mx_sat_cnt_ns_code';

                    break;
                case 'state':
                    typeSS = 'customrecord_mx_sat_states';
                    columnSat = 'custrecord_mx_sat_state_code'

                    columnsSS.push(search.createColumn({ name: 'internalid', sort: search.Sort.ASC }));
                    columnsSS.push(search.createColumn({ name: 'custrecord_mx_sat_state_name' }));
                    columnsSS.push(search.createColumn({ name: columnSat }));
                    columnsSS.push(search.createColumn({ name: 'custrecord_mx_sat_state_ns_code' }));

                    filterType = 'custrecord_mx_sat_state_ns_code';

                    break;
            }

            //BMS-523.so
            /*var filtersSS = search.createFilter({name: filterType, operator:search.Operator.IS, values: codeNS}); //BMS-523.o
            var srchObj = search.create({type: typeSS, filters: filtersSS, columns: columnsSS}).run(); //BMS-523.o
    
            var srchResults = srchObj.getRange(0,10);
            if(srchResults){
                codeSat = srchResults[0].getValue(columnSat);
            }
            log.debug('lib codeSat', codeSat);
            return codeSat;*/ //BMS-523.eo
            //BMS-523.sn
            var srchObj = loadSearch(typeSS, null, null, columnsSS);
            var codesSat = [];
            srchObj.forEach(function (rec) {
                var codesObj = {};
                codesObj.id = rec.id;
                codesObj.codeSat = rec.getValue(columnSat);
                codesObj.codeNS = type == 'country' ? rec.getValue("custrecord_mx_sat_cnt_ns_code") : rec.getValue("custrecord_mx_sat_state_ns_code");

                codesSat.push(codesObj);
            });

            return codesSat;
        }

        //Obtiene la información de dirección y datos fiscales de la empresa o subsidiaria emisora de una factura en NetSuite
        function getCompanyAddressInformation(context) {

            var cceFields = {
                subsidiaryTaxid: null,
                companyTaxId: null,
                subsidiaryAddress: null,
                companyAddress: null
            };

            var subsidiaryfeatureInEffect = runtime.isFeatureInEffect({
                feature: 'SUBSIDIARIES'
            });

            if (subsidiaryfeatureInEffect) {

                var subsidiary = context.newRecord.getValue('subsidiary');

                if (subsidiary) {

                    cceFields.subsidiary = subsidiary;
                }
            } else {

                var companyInfo = config.load({ type: config.Type.COMPANY_INFORMATION });

                cceFields.state = companyInfo.getValue({ fieldId: 'state' });

                cceFields.country = companyInfo.getValue({ fieldId: 'country' });

                cceFields.companyTaxId = companyInfo.getValue({ fieldId: 'employerid' }) || companyInfo.getValue({ fieldId: 'taxid' });

                cceFields.companyAddress = companyInfo.getValue({ fieldId: 'mainaddress_text' });
            }

            searchCompanyAddresses(cceFields);

            fillInvoiceCCEPropietarioFields(context, cceFields);

            fillInvoiceCCEEmisorFields(context, cceFields);

        }

        //busca la información de la dirección fiscal de una subsidiaria o empresa en NetSuite para su posterior uso en la emisión de facturas electrónicas CFDI con complemento de Comercio Exterior (CCE).
        function searchCompanyAddresses(cceFields) { 

            var subsidiarySearch = getSearchAddresCompany(); //BMS-692.n
            if (cceFields.hasOwnProperty('subsidiary')) {

                var tempFilters = subsidiarySearch.filterExpression;

                tempFilters.push(['internalid', 'is', cceFields.subsidiary]);

                subsidiarySearch.filterExpression = tempFilters;
            }

            var subsidiarySearchPagedData = subsidiarySearch.runPaged({ pageSize: 1000 });

            for (var i = 0; i < subsidiarySearchPagedData.pageRanges.length; i++) {

                var subsidiarySearchPage = subsidiarySearchPagedData.fetch({ index: i });

                subsidiarySearchPage.data.forEach(function (result) {

                    cceFields.zipCode = result.getValue({ name: 'zip', join: 'Address' });

                    cceFields.streetType = result.getValue({ name: 'custrecord_streettype', join: 'Address' });

                    cceFields.internalNum = result.getValue({ name: 'custrecord_unit', join: 'address' });

                    cceFields.streetName = result.getValue({ name: 'custrecord_streetname', join: 'address' });

                    cceFields.city = result.getValue({ name: 'city', join: 'address' });

                    cceFields.colonia = result.getValue({ name: 'custrecord_colonia', join: 'address' });

                    cceFields.alfa2Country = result.getValue({ name: 'countrycode', join: 'address' });

                    cceFields.state = result.getValue({ name: 'state', join: 'address' });

                    cceFields.village = result.getValue({ name: 'custrecord_village', join: 'address' });

                    cceFields.streetNum = result.getValue({ name: 'custrecord_streetnum', join: 'address' });

                    cceFields.countryName = result.getValue({ name: 'country', join: 'address' });

                    cceFields.floor = result.getValue({ name: 'custrecord_floor', join: 'address' });

                    cceFields.subsidiaryTaxid = result.getValue({ name: 'taxidnum' });

                    cceFields.subsidiaryAddress = result.getValue({ name: 'address', join: 'address' });

                    cceFields.stateId = getBITCCEEstadoEmisor(cceFields.state);

                    cceFields.countryId = getBITCCEPaisEmisor(cceFields.alfa2Country);

                    cceFields.taxResidenceId = getBITFEResidenciaFiscal(cceFields.alfa2Country);

                    const alfaCountry = cceFields.alfa3Country ? cceFields.alfa3Country : cceFields.alfa2Country;
                    const idBitLTCountrie = getBitLtCountries(alfaCountry);
                    cceFields.countryId = idBitLTCountrie

                    cceFields.taxResidenceId = idBitLTCountrie
                });
            }
        }

        //Completa automáticamente los campos requeridos para el complemento de Comercio Exterior (CCE) en una invoice 
        function populateInvoiceCCEFields(context) {  
            try {
                const method = 'populateInvoiceCCEFields';
                var recordType = context.newRecord.type; 
                var entity = recordType == 'customerpayment' ? context.newRecord.getValue('customer') : context.newRecord.getValue('entity'); //BMS-627.n
                if (!entity) return false;
                log.debug({ title: method + "Endity : " + entity, details: context });
                getCustomerAddressInformation(context);
                getCompanyAddressInformation(context);

            } catch (error) {
                log.error({
                    title: 'error in function: populateInvoiceCCEFields',
                    details: error
                });
            }
        } 

        //Obtiene una lista de grupos de impuestos (Tax Groups) desde una búsqueda guardada en NetSuite y devuelve un objeto que contiene los internalId de esos grupos como claves.
        function getTaxGroups() { 
            try {
                var objTaxGroups = {};

                var listTaxGroup = getSearchTaxGroup();                                                            

                listTaxGroup.forEach(function (rec) {

                    var internalId = rec.getValue('internalid');
                    objTaxGroups[internalId] = true;
                });

                return objTaxGroups;

            } catch (error) {
                log.error({ title: 'error in function getTaxGroups', details: error });
            }
        }

        
        //Obtiene la tasa de cambio (exchange rate) entre dos monedas en una fecha determinada.
        function getCurrExchangeRate(baseCurrency, sourceCurrency, trandate) { //BMS-649.n
            return currency.exchangeRate({ //BMS-649.sn
                source: baseCurrency,
                target: sourceCurrency,
                date: new Date(trandate)
            }); //BMS-649.en

            /*var sFilter = []; //BMS-649.so
            sFilter.push(search.createFilter({ name:'basecurrency', operator:search.Operator.ANYOF, values: baseCurrency }));
            sFilter.push(search.createFilter({ name:'transactioncurrency', operator:search.Operator.ANYOF, values: sourceCurrency }));
            var listTaxGroup = loadSearch(null,'customsearch_bit_mx_loc_list_curr_exch', sFilter, null);
    
            return listTaxGroup[0].getValue('exchangerate');*/ //BMS-649.eo
        }
     
        //Crea y devuelve una búsqueda guardada que obtiene información de la dirección de facturación predeterminada de los clientes.
        function getSearchAddressCustomerCce() {
            return search.create({
                type: "customer",
                filters:
                    [
                        ["address.isdefaultbilling", "is", "T"]
                    ],
                columns:
                    [
                        search.createColumn({ name: "entityid", label: "ID" }),
                        //search.createColumn({name: "altname", label: "Name"}),//BMS-804.o
                        search.createColumn({ name: "formulatext_altname", formula: "NVL({companyname},{firstname}||''||{lastname})", label: "Name" }),//BMS-804.n
                        search.createColumn({
                            name: "address",
                            join: "Address",
                            label: "Address"
                        }),
                        search.createColumn({
                            name: "addressinternalid",
                            join: "Address",
                            label: "Address Internal ID"
                        }),
                        search.createColumn({
                            name: "addresslabel",
                            join: "Address",
                            label: "Address Label"
                        }),
                        search.createColumn({
                            name: "addressee",
                            join: "Address",
                            label: "Addressee"
                        }),
                        search.createColumn({
                            name: "attention",
                            join: "Address",
                            label: "Attention"
                        }),
                        search.createColumn({
                            name: "city",
                            join: "Address",
                            label: "City"
                        }),
                        search.createColumn({
                            name: "custrecord_colonia",
                            join: "Address",
                            label: "Colonia"
                        }),
                        search.createColumn({
                            name: "country",
                            join: "Address",
                            label: "Country"
                        }),
                        search.createColumn({
                            name: "countrycode",
                            join: "Address",
                            label: "Country Code"
                        }),
                        search.createColumn({
                            name: "isdefaultbilling",
                            join: "Address",
                            label: "Default Billing Address"
                        }),
                        search.createColumn({
                            name: "state",
                            join: "Address",
                            label: "State/Province"
                        }),
                        search.createColumn({
                            name: "statedisplayname",
                            join: "Address",
                            label: "State/Province Display Name"
                        }),
                        search.createColumn({
                            name: "custrecord_streetname",
                            join: "Address",
                            label: "Street Name"
                        }),
                        search.createColumn({
                            name: "custrecord_streetnum",
                            join: "Address",
                            label: "Street Number"
                        }),
                        search.createColumn({
                            name: "custrecord_streettype",
                            join: "Address",
                            label: "Street Type"
                        }),
                        search.createColumn({
                            name: "custrecord_unit",
                            join: "Address",
                            label: "Unit Number"
                        }),
                        search.createColumn({
                            name: "custrecord_village",
                            join: "Address",
                            label: "Village"
                        }),
                        search.createColumn({
                            name: "zipcode",
                            join: "Address",
                            label: "Zip Code"
                        }),
                        search.createColumn({
                            name: "custrecord_floor",
                            join: "Address",
                            label: "FL"
                        }),
                        search.createColumn({ name: "vatregnumber", label: "Tax Number" }),
                        search.createColumn({
                            name: "custrecord_locality",
                            join: "Address",
                            label: "Locality"
                        }),
                        search.createColumn({
                            name: "custrecord_bit_lt_country_sbrcd",
                            join: "Address",
                            label: "countryIdNew"
                        }),
                        search.createColumn({ name: "custentity_bit_mx_loc_cust_tax_id", label: "TAX ID" })
                    ]
            });
        }

        //Busca y devuelve el ID interno de una moneda en NetSuite, dado su símbolo.
        function getCurrencyId(currSymbol) {                                                      
            var columnCurr = [];
            var filterCurr = [];
            columnCurr.push(search.createColumn({ name: 'symbol', label: 'Symbol' }));
            filterCurr.push(search.createFilter({ name: 'symbol', operator: 'is', values: currSymbol }));

            var resultCurr = search.create({ type: 'currency', filters: filterCurr, columns: columnCurr }).run();

            var dataCurr = resultCurr.getRange(0, 1);

            return dataCurr[0].id;
        }          

        //Devuelve una búsqueda de los grupos de impuestos (tax group) en NetSuite.
        function getSearchTaxGroup() {                   
            var sFilter = [];
            var sColumn = [];
            var sSettings = [];

            sColumn.push(
                search.createColumn({ name: "internalid", label: "ID interno" })
            );

            return loadSearch(search.Type.TAX_GROUP, null, sFilter, sColumn, sSettings);
        }

        //Obtiene y agrupa los montos de impuestos aplicados a una o más facturas (invoiceInternalid) desde las líneas del libro mayor (GL) que representan líneas de impuestos (taxline = true)
        function getPaymentInvoicesTaxLinesData(invoiceInternalid) {
            var taxAmountColumn = search.createColumn({ name: 'formulanumeric', formula: 'ROUND(ABS(NVL({debitamount},0)-NVL({creditamount},0))/NVL({exchangerate},1),2)', summary: search.Summary.SUM })
            var taxTypeColumn = search.createColumn({ name: 'formulatext', formula: "CASE WHEN UPPER({taxitem.itemid}) LIKE '%IEPS%' THEN 'IEPS' WHEN UPPER({taxitem.itemid}) LIKE '%IVA%' THEN 'IVA' ELSE 'ISR' END", summary: search.Summary.GROUP })
            var internalidColumn = search.createColumn({ name: 'internalid', summary: search.Summary.GROUP })
            var glTaxAmounSearch = search.create({
                type: 'transaction',
                filters: [search.createFilter({
                    name: 'internalid',
                    operator: search.Operator.ANYOF,
                    values: invoiceInternalid
                }),
                search.createFilter({
                    name: 'taxline',
                    operator: search.Operator.IS,
                    values: true
                })],
                columns: [internalidColumn, taxAmountColumn, taxTypeColumn],
                settings: [
                    search.createSetting({
                        name: 'consolidationtype',
                        value: 'NONE'
                    })]
            }).run().getRange({
                start: 0,
                end: 1000
            });
            var glTaAmountByType = {};
            glTaxAmounSearch.map(function (searchResultTaxAmount) {
                var invoceId = searchResultTaxAmount.getValue(internalidColumn);
                var gltype = searchResultTaxAmount.getValue(taxTypeColumn);
                var glAmount = searchResultTaxAmount.getValue(taxAmountColumn);
                if (!glTaAmountByType[invoceId]) {
                    glTaAmountByType[invoceId] = {}
                }
                glTaAmountByType[invoceId][gltype] = glAmount;
                return;
            })
            return glTaAmountByType;
        }
       
        //Verifica si una transacción específica contiene al menos un ítem de tipo "Discount".
        function validateTransactionItemDiscount(transcationId) {
            var transactionSearchObj = search.create({
                type: "transaction",
                filters:
                    [
                        ["internalidnumber", "equalto", transcationId],
                        "AND",
                        ["item.type", "anyof", "Discount"]
                    ],
                columns:
                    [
                        search.createColumn({ name: "internalid", label: "Internal ID" })
                    ]
            });
            var searchResultCount = transactionSearchObj.runPaged().count;
            return searchResultCount > 0;
        }


        return {
            getSubsidiaryConfig: getSubsidiaryConfig,
            isEmpty: isEmpty,
            notEmpty: notEmpty,
            isNull: isNull,
            notNull: notNull,
            createException: createException,
            setDateTimeFormat: setDateTimeFormat,
            getRecordDocNo: getRecordDocNo,
            replaceData: replaceData,
            getMissingFields: getMissingFields,
            createFile: createFile,
            noValuesFound: noValuesFound,
            removeMissingData: removeMissingData,
            removeDoblePipes: removeDoblePipes,
            getExchangeRate: getExchangeRate,
            getIdentifiers: getIdentifiers,
            isAddendaDetallista: isAddendaDetallista,
            isAddendaInstalled: isAddendaInstalled,
            isTesting: isTesting,
            fmtDec: fmtDec,
            formatTodayDate: formatTodayDate, 
            getScriptDeployment: getScriptDeployment, //SPRINT/14.n
            getLengthDecimals: getLengthDecimals, //SPRINT/15.n
            removeSpecialCharacters: removeSpecialCharacters, //SPRINT/15.n
            getInvoiceControl: getInvoiceControl, //SPRINT/18.n
            loadSearch: loadSearch,
            numberToWords: numberToWords, //SPRINT/18.n
            searchConfigFolders: searchConfigFolders,//BSMX-125.sn
            searchFolderInConfig: searchFolderInConfig,
            createSubsidiaryFolders: createSubsidiaryFolders,
            existingConfig: existingConfig,
            searchFolder: searchFolder,
            createFolder: createFolder,//BSMX-125.en
            isItemTypeApp: isItemTypeApp, //BSMX-223.n
            isSSPercentageApplicable: isSSPercentageApplicable, //BSMX-223.n
            removeSpecialCharactersWtAmp: removeSpecialCharactersWtAmp, //BSMX-230.n
            escapeAmp: escapeAmp, //BSMX-230.n
            getPagoCfdiDefault: getPagoCfdiDefault, //BSMX-237.n
            searchFile: searchFile,
            sendEmail: sendEmail, //BSMX-275.n
            searchDeployment: searchDeployment, //BSMX-271.n
            getInvoicesData: getInvoicesData, //BSMX-279.n
            reconcileAccountS: reconcileAccountS, // BSMS-253.n
            validatePermissionRole: validatePermissionRole, //BSMX-255.n
            getClaveUnidad: getClaveUnidad,
            getClaveUnidadItemKitOrGroup: getClaveUnidadItemKitOrGroup, //BSMX-344.n
            getClaveUnidadOptimized: getClaveUnidadOptimized, //BSMX-361.n
            getCurrencySymbol: getCurrencySymbol, //BSMX-335.n
            convertTo24Hour: convertTo24Hour,
            getSatCode: getSatCode, //BSMX-335.n
            populateInvoiceCCEFields: populateInvoiceCCEFields, //BSMX-250.n
            getSATUnitCodeList: getSATUnitCodeList, //BSMX-377.n
            getSatUnitCode: getSatUnitCode, //BSMX-377.n
            getMetodoDePago: getMetodoDePago, // BSMX-373.n
            getUsoCFDi: getUsoCFDi, // BSMX-373.n
            getTaxGroups: getTaxGroups, //BSMX-366.n
            validateFacAtrAdquirente: validateFacAtrAdquirente, //BSMX-366.n
            setVersionCFDi: setVersionCFDi, //BSMX-366.n
            formatDisclaimer: formatDisclaimer, //BSMX-387.n
            removeOptionalFields: removeOptionalFields, //BSMX-380.n
            getInvoicesAndLinesData: getInvoicesAndLinesData, //BSMX-406
            escapeQuot: escapeQuot, //BMS-467.n
            getGroupOfArrayData: getGroupOfArrayData, //BMS-502.n
            getTaxId: getTaxId, //BMS-515.n
            validarFolioFactura: validarFolioFactura, //BMS-578.n
            generateFolioFiscal: generateFolioFiscal, //BMS-578.n
            getCurrExchangeRate: getCurrExchangeRate, //BMS-616.n
            getTaxesMX: getTaxesMX, //BMS-646.n
            getNumParcialidad: getNumParcialidad, //BMS-668.n
            sendToPrintPdfCustom: sendToPrintPdfCustom, //BMS-683.n
            getCurrencyId: getCurrencyId, //BMS-691.n
            getSearchObjImpGpo: getSearchObjImpGpo,       //BMS-704.n
            getSearchReclaScrap: getSearchReclaScrap,     //BMS-704.n
            getPaymentInvoicesTaxLinesData: getPaymentInvoicesTaxLinesData,
            validateTransactionItemDiscount: validateTransactionItemDiscount //BMS-794.n
        };
    });