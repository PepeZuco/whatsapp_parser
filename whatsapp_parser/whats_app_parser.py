from wordcloud import WordCloud, STOPWORDS
from whatstk import df_from_txt_whatsapp
import matplotlib.pyplot as plt
import plotly.graph_objs as go
from itertools import product
import plotly_express as px
from utils import Utils
import pandas as pd
import plotly
import re
import os


class WhatsAppParser:
    def __init__(self, txt_file: str):
        """
        Initializes a WhatsAppParser instance.

        Parameters:
        - txt_file (str): Path to the .txt file containing WhatsApp chat data.
        """

        # Check if txt_file is provided
        if txt_file:
            # Read the content of the .txt file into a list
            self.txt_file_list = self._txt_file_to_list(txt_file)

        # self.chat_dict = self._organize_data_in_dict()
        # self.chat_dataframe = pd.DataFrame(self.chat_dict)  # Create a Pandas DataFrame from the organized chat data

        self.chat_downloaded_from_apple_device = True if self.txt_file_list[0].replace('\u200e', '').replace('~\u202f', '').startswith("[") else False

        self.chat_dataframe = df_from_txt_whatsapp(txt_file)
        self.chat_dataframe.rename(columns={
            'date': 'timestamp',
            'username': 'who_sended',
            'message': 'message'}, inplace=True)

        # Extract user information from the list of messages
        self.users = list(self.chat_dataframe['who_sended'].unique())
        self.group_chat = True if len(self.users) > 2 else False

        # Define attributes related to Excel file, folder, and chat data
        self.excel_file_name = self._define_excel_file_name()
        self._folder_name = self._define_folder_name()

        # Tidy up the DataFrame (potentially removing unnecessary columns, etc.)
        self._tidy_data_frame()

        # Define a color palette in hexadecimal format
        self.hex = {
            'yellow': '#fff700',
            'light pink': '#ff5efc',
            'light red': '#dd614a',
            'light orange': '#ff9b71',
            'light yellow': '#ffdc7c',
            'light green': '#25d366',
            'lighter green': '#e4fde1',
            'lighter pink': '#bf7ebd',
            'teal green': '#128c7e',
            'teal green dark': '#075e54',
            'verde_principal': '#25D366',
            'azul_principal': '#34B7F1',
            'amarelo_principal': '#FFCC29',
            'vermelho_principal': '#FD5757',
            'rosa_claro': '#ECE5DD',
            'cinza_escuro': '#545454',
            'main_wpp_1': '#0dc043',
            'main_wpp_2': '#14ca9c',
            'main_wpp_3': '#009588',
            'main_wpp_4': '#00a884',
            'main_wpp_5': '#ffffff',
            'main_wpp_6': '#202c33',
            'main_wpp_7': '#285233',
            '# of messages per hour': {
                '0': '#04020d', '1': '#0a051f', '2': '#0b0524', '3': '#0a0324',
                '4': '#0a0324', '5': '#17275c', '6': '#5264a1', '7': '#7c8fcc',
                '8': '#9aace6', '9': '#cccc62', '10': '#e8e858', '11': '#e8e83a',
                '12': '#ffff00', '13': '#ffc400', '14': '#ffbb00', '15': '#ffae00',
                '16': '#ffa200', '17': '#ff8c00', '18': '#111521', '19': '#101424',
                '20': '#0a1026', '21': '#04091a', '22': '#01040d', '23': '#000000',
            }
        }

        # List of words to be removed during text processing
        self.words_to_be_removed = [
            'a', 'ao', 'ainda', 'agora', 'aqui', 'algo', 'aí', 'assim', 'ai', 'até', 'ah', 'audio', 'anexado', 'apagada',
            'b',
            'c', 'como', 'coisa',
            'd', 'da', 'de', 'deu', 'do', 'dar', 'dos', 'dele', 'dela',
            'e', 'eu', 'estar', 'então', 'está', 'estou', 'eh', 'é', 'em', 'ele', 'ela', 'esse', 'essa', 'estão', 'era',
            'f', 'foi', 'faz',
            'g',
            'h', 'https',
            'i', 'isso', 'ia', 'ir',
            'j', 'ja', 'já', 'jpg',
            'k',
            'l', 'la', 'lá',
            'm', 'mas', 'mais', 'meu', 'ma', 'Ma', 'muito', 'mim', 'Mensagem apagada', 'Mensagem',
            'n', 'né', 'não', 'nao', 'nós', 'nada', 'na', 'nem',
            'o', 'os', 'ou', 'opus', 'omitido',
            'p', 'pra', 'pro', 'para', 'porque', 'pode', 'por', 'pq', 'porq', 'photo',
            'q', 'que', 'quando', 'qual', 'quer',
            'r',
            's', 'sim', 'se', 'sobre', 'sabe', 'ser', 'seu', 'só', 'sua',
            't', 'ta', 'tá', 'tem', 'tô', 'tudo', 'todos', 'ter', 'te', 'tava', 'tal', 'tb',
            'u', 'uma', 'um',
            'v', 'vc', 'você', 'voce', 'vou', 'vai', 'ver', 'viu',
            'w', 'www',
            'x',
            'y',
            'z'
        ]
        self.weekdays_translation = {
            'Monday': 'Segunda-feira',
            'Tuesday': 'Terça-feira',
            'Wednesday': 'Quarta-feira',
            'Thursday': 'Quinta-feira',
            'Friday': 'Sexta-feira',
            'Saturday': 'Sábado',
            'Sunday': 'Domingo'
        }

    def _txt_file_to_list(self,
                          file: str
                          ) -> list:
        """
        Reads the content of a .txt file and returns a list where each item is a line from the file.

        Parameters:
        - file (str): Path to the .txt file.

        Returns:
        - list: A list where each item represents a line from the .txt file.
        """

        # Open the .txt file in read mode with UTF-8 encoding
        with open(file, 'r', encoding='utf-8') as data:
            lines = data.read().splitlines()

        return lines

    def _organize_data_in_dict(self) -> dict:
        """
        Organizes WhatsApp chat data into a dictionary.

        Returns:
        - dict: A dictionary containing the following keys:
            - 'timestamp': Date and time that the message was sent
            - 'who_sended': Person who sent the message
            - 'message': Message content
            - 'message_type': Type of message (audio, video, photo, sticker, text)
        """

        # Regular expression to extract information
        regex = re.compile(r"\[(?P<timestamp>[\d\/\,\s:]+)\] (?P<who_sended>.*?): (?P<message>.*?)$")

        # Initializing lists in the dictionary
        result = {"timestamp": [], "who_sended": [], "message": [], "message_type": []}

        # Iterating over messages
        for c, message in enumerate(self.txt_file_list):
            message = message.replace('\u200e', '').replace('~\u202f', '')
            match = regex.match(message)

            # Checking if it's a valid message
            if match:
                message_text = match.group('message')

                # In some cases, the first message is the Group name with the cryptography message
                if c == 0: self.chat_has_group_name = any(keyword in message_text.lower() for keyword in ['criptografia', 'cryptography'])

                if 'criou este grupo' not in message_text and \
                   'adicionou você' not in message_text:
                    # Determine message type based on content
                    if message_text in ['áudio ocultado', 'audio omitted']: message_type = 'Audio'
                    elif message_text in ['vídeo omitido', 'video omitted']: message_type = 'Video'
                    elif message_text in ['imagem ocultada', 'image omitted']: message_type = 'Foto'
                    elif message_text in ['figurinha omitida', 'sticker omitted']: message_type = 'Sticker'
                    elif message_text in ['GIF omitido', 'GIF omitted']: message_type = 'GIF'
                    else: message_type = 'Text'

                    result["timestamp"].append(match.group('timestamp').replace(',', ''))
                    result["who_sended"].append(match.group('who_sended'))
                    result["message"].append(message_text)
                    result["message_type"].append(message_type)

            # If there's no match, it means the line is a continuation of the last line
            else:
                result["message"][-1] += f"\n{message}"

        return result

    def _define_excel_file_name(self) -> str:
        """
        Defines the name for the Excel file based on the last message timestamp and user information.

        Returns:
        - str: The generated Excel file name.
        """

        # Extract the timestamp from the last message
        last_message_timestamp = self.txt_file_list[-1][1:21].replace(', ', '_').replace('/', '').replace(':', '')

        # Check the number of users in the chat
        if len(self.users) > 2:
            # If more than two users, use a format with the timestamp and part of the chat title
            return f"{last_message_timestamp[1:]}_{self.txt_file_list[0].split(':')[2][4:]}.xlsx"
        else:
            # If two users, use a format with the timestamp and usernames
            return f"{last_message_timestamp}_{self.users[0]}-{self.users[1]}.xlsx"

    def _define_folder_name(self) -> str:
        """
        Defines the name for the folder based on the last message timestamp and user information.

        Returns:
        - str: The generated folder name.
        """

        # Extract the timestamp from the last message
        last_message_timestamp = self.txt_file_list[-1][1:21].replace(', ', '_').replace('/', '').replace(':', '')

        # Check the number of users in the chat
        if len(self.users) > 2:
            # If more than two users, use a format with the timestamp and part of the chat title
            return f"{last_message_timestamp[1:]}_{self.txt_file_list[0].split(':')[2][4:]}"
        else:
            # If two users, use a format with the timestamp and usernames
            return f"{last_message_timestamp}_{self.users[0]}-{self.users[1]}"

    def save_chat_to_excel_file(self,
                                file_name: str = None,
                                path: str = None
                                ):
        """
        Saves the chat data to an Excel file.

        Parameters:
        - file_name (str, optional): Name of the Excel file. If not provided, uses the pre-defined Excel file name.
        - path (str, optional): Path where the Excel file will be saved. If not provided, uses the current working directory.
        """

        # Set default values if parameters are not provided
        if file_name is None: file_name = self.excel_file_name
        if not file_name.endswith(".xlsx"): file_name += ".xlsx"
        if path is None: path = os.getcwd()

        # Create the full file path
        file_path = os.path.join(path, file_name)

        # Save the chat DataFrame to an Excel file
        self.chat_dataframe.to_excel(file_path, index=False)

    def _remove_cryptography_message(self):
        """
        Removes the cryptography warning message from the chat data.

        If the first message in the chat contains the words 'cryptography' or 'criptografia',
        it is considered a cryptography warning message and is removed from the chat data.
        """

        # Check if the cryptography warning message is present
        if 'cryptography' in self.chat[0] or 'criptografia' in self.chat[0]: del self.chat[0]  # Remove the cryptography warning message from the chat data

    def _create_graphs_folder(self):
        """
        Creates a folder to store graphs.

        If the folder does not already exist, it will be created.
        """
        if not os.path.exists(self._folder_name): os.makedirs(self._folder_name)  # Creating folder to store the graphs

    def _tidy_data_frame(self):
        """
        Tidies up the chat DataFrame by converting timestamp to datetime,
        extracting date, time, hour, and weekday information.

        The 'timestamp' column is converted to datetime format with the specified format and dayfirst parameter.
        New columns 'date', 'time', 'hour', and 'weekday' are created based on the 'timestamp' information.
        """
        # Convert 'timestamp' to datetime format
        try: self.chat_dataframe['timestamp'] = pd.to_datetime(self.chat_dataframe['timestamp'], format='%d/%m/%Y %H:%M:%S', dayfirst=True)
        except: self.chat_dataframe['timestamp'] = pd.to_datetime(self.chat_dataframe['timestamp'], format='%y/%m/%d %H:%M:%S', dayfirst=True)

        # Extract date, time, hour, and weekday information
        self.chat_dataframe['date'] = self.chat_dataframe['timestamp'].dt.date
        self.chat_dataframe['time'] = self.chat_dataframe['timestamp'].dt.time
        self.chat_dataframe['hour'] = self.chat_dataframe['timestamp'].dt.hour
        self.chat_dataframe['weekday'] = pd.to_datetime(self.chat_dataframe['date']).dt.day_name()
        day_mapping = {"Monday": 1, "Tuesday": 2, "Wednesday": 3, "Thursday": 4, "Friday": 5, "Saturday": 6, "Sunday": 7}
        self.chat_dataframe['weekday_number'] = self.chat_dataframe['weekday'].map(day_mapping)
        self.chat_dataframe['message'] = self.chat_dataframe['message'].str.replace('\u200e', '').str.replace('\u202f', '')

        self.chat_is_group = True if self.chat_dataframe['who_sended'].nunique() > 2 else False
        first_row = self.chat_dataframe.loc[self.chat_dataframe.index[0]]['message']

        if self.chat_is_group:
            if any(keyword in first_row.lower() for keyword in ['criptografia', 'cryptography']):
                rows_to_delete = self.chat_dataframe.loc[0]['who_sended']
                self.chat_dataframe = self.chat_dataframe[self.chat_dataframe['who_sended'] != rows_to_delete]

        self.chat_dataframe['message_type'] = self.chat_dataframe['message'].apply(self._categorize_message)

    def _categorize_message(self, message):

        if self.chat_downloaded_from_apple_device:
            possible_audio_messages = ['áudio ocultado', 'audio omitted', 'áudio ocultado\n', 'audio omitted\n']
            possible_video_messages = ['vídeo omitido', 'video omitted', 'vídeo omitido\n', 'video omitted\n']
            possible_image_messages = ['imagem ocultada', 'image omitted', 'imagem ocultada\n', 'image omitted\n']
            possible_sticker_messages = ['figurinha omitida', 'sticker omitted', 'figurinha omitida\n', 'sticker omitted\n']
            possible_gif_messages = ['GIF omitido', 'GIF omitted', 'GIF omitido\n', 'GIF omitted\n']

            if message in possible_audio_messages: return 'Audio'
            elif message in possible_video_messages: return 'Video'
            elif message in possible_image_messages: return 'Foto'
            elif message in possible_sticker_messages: return 'Sticker'
            elif message in possible_gif_messages: return 'GIF'
            else: return 'Text'

        else:
            if message in ['<Mídia oculta>', '<Mídia oculta>\n']: return 'Mídia'
            else: return 'Text'

    def generate_graph_number_of_messages_per_day(self,
                                                  start_date: str = None,
                                                  end_date: str = None,
                                                  save_as_file: bool = False,
                                                  title: str = None,
                                                  file_name: str = None,
                                                  language: str = 'English 🇺🇸',
                                                  fill_missing: bool = False
                                                  ) -> plotly.graph_objs._figure.Figure:
        """
        Generates a line graph showing the number of messages per day within a specified date range.

        Parameters:
        - start_date (str, optional): Start date of the date range (format: 'YYYY-MM-DD').
        - end_date (str, optional): End date of the date range (format: 'YYYY-MM-DD').
        - save_as_file (bool, optional): If True, saves the graph as an HTML file.
        - title (str, optional): Title of the graph.
        - file_name (str, optional): Name of the HTML file if save_as_file is True.
        - fill_missing (bool, optional): If True, fills missing days with 0 messages for each user.

        Returns:
        - plotly.graph_objs._figure.Figure: The generated line graph.
        """

        texts = Utils.read_language_files(language)
        if not title: title = texts['Graph_1']['title']
        if not file_name: file_name = '# of messages per day'

        filtered_df = Utils.check_and_apply_filter_dates(start_date, end_date, self.chat_dataframe)
        chat_df_grouped = filtered_df.groupby(by=["date", "who_sended"], sort=False).count()['message'].reset_index()

        if fill_missing:
            # Generate a DataFrame with all dates within the range for each sender
            all_dates = pd.date_range(start=start_date, end=end_date).to_series(name='date')
            all_senders = pd.Series(filtered_df['who_sended'].unique(), name='who_sended')
            complete_df = pd.MultiIndex.from_product([all_dates, all_senders], names=['date', 'who_sended']).to_frame(index=False)

            # Convert 'date' columns to datetime
            complete_df['date'] = pd.to_datetime(complete_df['date'])
            chat_df_grouped['date'] = pd.to_datetime(chat_df_grouped['date'])

            # Merge and fill missing messages with 0
            complete_df = pd.merge(complete_df, chat_df_grouped, how='left', on=['date', 'who_sended'])
            complete_df['message'] = complete_df['message'].fillna(0)
            chat_df_grouped = complete_df

        fig = px.line(chat_df_grouped, x='date', y="message",
                      title=title,
                      labels={
                          'date': texts['Graph_1']['labels']["0"],
                          'who_sended': texts['Graph_1']['labels']["1"],
                          'message': texts['Graph_1']['labels']["2"],
                      },
                      color='who_sended',
                      color_discrete_sequence=[self.hex[f'main_wpp_{i}'] for i in range(1, 6)])

        if not self.group_chat:
            fig['data'][1]['line']['color'] = self.hex['main_wpp_1']
            fig['data'][0]['line']['color'] = self.hex['main_wpp_5']

        if save_as_file:
            self._create_graphs_folder()
            fig.write_html(f"{self._folder_name}/{file_name}.html")

        return fig

    def generate_graph_number_of_types_of_messages(self,
                                                   save_as_file: bool = False,
                                                   title: str = None,
                                                   file_name: str = None,
                                                   language: str = 'English 🇺🇸',
                                                   start_date: str = None,
                                                   end_date: str = None,
                                                   ) -> plotly.graph_objs._figure.Figure:
        """
        Generates a bar graph showing the number of each type of messages.

        Parameters:
        - save_as_file (bool, optional): If True, saves the graph as an HTML file.
        - title (str, optional): Title of the graph.
        - file_name (str, optional): Name of the HTML file if save_as_file is True.

        Returns:
        - plotly.graph_objs._figure.Figure: The generated bar graph.
        """

        # Set default values for title and file_name if not provided
        texts = Utils.read_language_files(language)
        if not title: title = texts['Graph_2']['title']
        if not file_name: file_name = '# of type of message'
        filtered_df = Utils.check_and_apply_filter_dates(start_date, end_date, self.chat_dataframe)

        # Group chat DataFrame by message type and count the number of messages
        chat_df_grouped = filtered_df.groupby(by=['message_type']).count()['message']
        chat_df_grouped = chat_df_grouped.reset_index(drop=False)

        # Create a bar graph using plotly express
        fig = px.bar(chat_df_grouped.sort_values(by=['message'], ascending=False), x='message_type', y='message',
                     labels={
                         'message': texts['Graph_2']['labels']['message'],
                         'message_type': texts['Graph_2']['labels']['message_type']},
                     color='message_type',
                     text='message',
                     title=title,
                     hover_name="message_type",
                     hover_data=["message"],
                     category_orders={"message_type": ["Text", "Audio", "Foto", "Sticker", "Video", "GIF"]})

        # Set marker colors for each message type
        try:
            offsetgroup_colors = {
                'Text': self.hex['main_wpp_1'],
                'Audio': self.hex['main_wpp_2'],
                'Foto': self.hex['main_wpp_3'],
                'Sticker': self.hex['main_wpp_4'],
                'Video': self.hex['main_wpp_5'],
                'GIF': self.hex['main_wpp_6'],
            }

            for entry in fig['data']:
                offsetgroup = entry['offsetgroup']
                if offsetgroup in offsetgroup_colors:
                    entry['marker']['color'] = offsetgroup_colors[offsetgroup]

        except Exception: pass

        # Update trace properties and layout
        fig.update_traces(texttemplate='', textposition='outside')
        fig.update_layout(uniformtext_minsize=8, uniformtext_mode='hide')

        # Save the graph as an HTML file if save_as_file is True
        if not save_as_file: return fig

        self._create_graphs_folder()
        fig.write_html(f"{self._folder_name}/{file_name}.html")

    def generate_graph_number_of_types_of_messages_per_user(self,
                                                            save_as_file: bool = False,
                                                            title: str = None,
                                                            file_name: str = None,
                                                            language: str = 'English 🇺🇸',
                                                            start_date: str = None,
                                                            end_date: str = None,
                                                            ) -> plotly.graph_objs._figure.Figure:
        """
        Generates a bar graph showing the number of each type of messages per user.

        Parameters:
        - save_as_file (bool, optional): If True, saves the graph as an HTML file.
        - title (str, optional): Title of the graph.
        - file_name (str, optional): Name of the HTML file if save_as_file is True.

        Returns:
        - plotly.graph_objs._figure.Figure: The generated bar graph.
        """

        # Set default values for title and file_name if not provided
        texts = Utils.read_language_files(language)
        if not title: title = texts['Graph_3']['title']
        if not file_name: file_name = '# of type of message per user'
        filtered_df = Utils.check_and_apply_filter_dates(start_date, end_date, self.chat_dataframe)

        # Group chat DataFrame by sender and message type, count the number of messages
        df_d = filtered_df.groupby(by=["who_sended", "message_type"]).count()["message"]
        df_d = df_d.reset_index(drop=False)

        # Calculate the total number of messages per user
        total_messages_per_user = df_d.groupby('who_sended')['message'].sum().reset_index()

        # Sort DataFrame based on the total number of messages in descending order
        total_messages_per_user = total_messages_per_user.sort_values(by='message', ascending=False)

        # Create a bar graph using plotly express
        fig = px.bar(df_d, x="who_sended", y="message",
                     color='message_type',
                     title=title,
                     labels={
                         'index': texts['Graph_3']['labels']['index'],
                         'who_sended': texts['Graph_3']['labels']['who_sended'],
                         'message_type': texts['Graph_3']['labels']['message_type'],
                         'message': texts['Graph_3']['labels']['message']
                     },
                     hover_name="message_type",
                     hover_data=["message"],
                     category_orders={"message_type": ["Text", "Audio", "Foto", "Sticker", "Video", "GIF"],
                                      "who_sended": total_messages_per_user['who_sended'].tolist()})
        # Set marker colors for each message type
        try:
            offsetgroup_colors = {
                'Text': self.hex['main_wpp_1'],
                'Audio': self.hex['main_wpp_2'],
                'Foto': self.hex['main_wpp_3'],
                'Sticker': self.hex['main_wpp_4'],
                'Video': self.hex['main_wpp_5'],
                'GIF': self.hex['main_wpp_6'],
            }

            for entry in fig['data']:
                offsetgroup = entry['offsetgroup']
                if offsetgroup in offsetgroup_colors:
                    entry['marker']['color'] = offsetgroup_colors[offsetgroup]

        except Exception: pass

        # Save the graph as an HTML file if save_as_file is True
        if not save_as_file: return fig

        self._create_graphs_folder()
        fig.write_html(f"{self._folder_name}/{file_name}.html")

    def generate_graph_number_of_messages_per_hour(self,
                                                   save_as_file: bool = False,
                                                   title: str = None,
                                                   file_name: str = None,
                                                   language: str = 'English 🇺🇸',
                                                   start_date: str = None,
                                                   end_date: str = None,
                                                   ) -> plotly.graph_objs._figure.Figure:
        """
        Generates a bar graph showing the number of messages per hour.

        Parameters:
        - save_as_file (bool, optional): If True, saves the graph as an HTML file.
        - title (str, optional): Title of the graph.
        - file_name (str, optional): Name of the HTML file if save_as_file is True.

        Returns:
        - plotly.graph_objs._figure.Figure: The generated bar graph.
        """

        # Set default values for title and file_name if not provided
        texts = Utils.read_language_files(language)
        if not title: title = texts['Graph_4']['title']
        if not file_name: file_name = '# of messages per hour'
        filtered_df = Utils.check_and_apply_filter_dates(start_date, end_date, self.chat_dataframe)

        # Create a DataFrame with all hours
        all_hours_df = pd.DataFrame({'hour': range(24)})

        # Merge with your current DataFrame to fill missing hours with 0 messages
        df_d = pd.merge(all_hours_df, filtered_df.groupby(by=["hour"]).count()['message'].reset_index(),
                        how='left', on='hour').fillna(0)

        # Sort the DataFrame by hour
        df_d = df_d.sort_values('hour', ascending=True)

        # Create a bar graph using plotly express
        fig = px.bar(df_d, x='hour', y='message',
                     text='message',
                     color="message",
                     title=title,
                     labels={
                         'message': texts['Graph_4']['labels']['message'],
                         'hour': texts['Graph_4']['labels']['hour']
                     },
                     color_continuous_scale='Greens')

        # Update trace properties and layout
        fig.update_traces(texttemplate='', textposition='auto')

        fig.update_xaxes(
            showgrid=True,
            ticks="outside",
            tickson="boundaries",
            ticklen=20,
            tickmode='array',
            tickvals=df_d['hour'].tolist(),
            ticktext=df_d['hour'].tolist()
        )

        fig.update_layout(uniformtext_minsize=10, bargap=0.1)

        # Save the graph as an HTML file if save_as_file is True
        if not save_as_file: return fig

        self._create_graphs_folder()
        fig.write_html(f"{self._folder_name}/{file_name}.html")

    def generate_word_cloud(self,
                            remove_words: list = None,
                            save_as_file: bool = False,
                            file_name: str = None
                            ) -> WordCloud:
        """
        Generates a word cloud from text messages.

        Parameters:
        - remove_words (list, optional): List of words to be removed from the word cloud.
        - save_as_file (bool, optional): If True, saves the word cloud as a PNG file.
        - file_name (str, optional): Name of the PNG file if save_as_file is True.

        Returns:
        - WordCloud: The generated word cloud object.
        """

        # Set default values for file_name and remove_words if not provided
        if not file_name: file_name = 'WordCloud'
        if not remove_words: remove_words = self.words_to_be_removed

        # Filter DataFrame to include only text messages
        df = self.chat_dataframe[self.chat_dataframe['message_type'] == 'Text']

        # Concatenate all text messages into a single string
        summary = df['message']
        all_summary = " ".join(str(s) for s in summary)

        # Set up stopwords and update with words to be removed
        stopwords = set(STOPWORDS)
        stopwords.update(remove_words)

        wordcloud = WordCloud(stopwords=stopwords,
                              background_color='black',
                              width=1600,
                              height=800,
                              colormap='BuGn_r').generate(all_summary)

        # Create a plot for the word cloud
        _, ax = plt.subplots(figsize=(16, 8))
        ax.imshow(wordcloud, interpolation='bilinear')
        ax.set_axis_off()

        # Save the word cloud as a PNG file if save_as_file is True
        if not save_as_file: return wordcloud

        self._create_graphs_folder()
        wordcloud.to_file(f'{self._folder_name}/{file_name}.png')

    def generate_number_of_messages_per_user(self,
                                             save_as_file: bool = False,
                                             title: str = None,
                                             file_name: str = None,
                                             language: str = 'English 🇺🇸',
                                             start_date: str = None,
                                             end_date: str = None,
                                             ) -> plotly.graph_objs._figure.Figure:
        """
        Generates a pie chart showing the number of messages per user.

        Parameters:
        - save_as_file (bool, optional): If True, saves the pie chart as an HTML file.
        - title (str, optional): Title of the pie chart.
        - file_name (str, optional): Name of the HTML file if save_as_file is True.

        Returns:
        - plotly.graph_objs._figure.Figure: The generated pie chart.
        """

        # Set default values for title and file_name if not provided
        texts = Utils.read_language_files(language)
        if not title: title = texts['Graph_5']['title']
        if not file_name: file_name = '# of messages per user'
        filtered_df = Utils.check_and_apply_filter_dates(start_date, end_date, self.chat_dataframe)

        # Count the number of messages per user
        message_counts = filtered_df['who_sended'].value_counts()

        group = [self.hex[f'main_wpp_{i}'] for i in range(1, 6)]
        not_group = [self.hex['main_wpp_1'], self.hex['main_wpp_5']]
        fig = px.pie(
            names=message_counts.index,
            values=message_counts,
            title=title,
            color_discrete_sequence=group if self.group_chat else not_group
        )

        # Save the pie chart as an HTML file if save_as_file is True
        if not save_as_file: return fig

        self._create_graphs_folder()
        fig.write_html(f"{self._folder_name}/{file_name}.html")

    def generate_activity_heatmap(self,
                                  save_as_file: bool = False,
                                  title: str = None,
                                  file_name: str = None,
                                  language: str = 'English 🇺🇸',
                                  start_date: str = None,
                                  end_date: str = None,
                                  ) -> go.Figure:
        """
        Generates an activity heatmap showing the message count per hour of the day and day of the week.

        Parameters:
        - save_as_file (bool, optional): If True, saves the heatmap as an HTML file.
        - title (str, optional): Title of the heatmap.
        - file_name (str, optional): Name of the HTML file if save_as_file is True.

        Returns:
        - go.Figure: The generated activity heatmap.
        """

        # Set default values for title and file_name if not provided
        texts = Utils.read_language_files(language)
        if not title:
            title = texts['Graph_6']['title']
        if not file_name:
            file_name = 'Activity Heatmap'
        filtered_df = Utils.check_and_apply_filter_dates(start_date, end_date, self.chat_dataframe)

        # Generate all combinations of weekday numbers and hours
        all_combinations = pd.DataFrame(list(product(range(7), range(24))),
                                        columns=['weekday_number', 'hour'])
        all_combinations['weekday_number'] = all_combinations['weekday_number'].astype(int)
        all_combinations['hour'] = all_combinations['hour'].astype(int)

        # Calculate message counts per weekday and hour
        activity_data = filtered_df.groupby(['weekday_number', 'hour']).size().reset_index(name='message_count')

        # Merge all combinations with actual data, filling missing values with zeros
        result = pd.merge(all_combinations, activity_data, on=['weekday_number', 'hour'], how='left').fillna(0)
        result.sort_values(by=['weekday_number', 'hour'], ascending=[True, True], inplace=True)

        # Pivot the result to create a table with rows as weekday numbers, columns as hours, and values as message counts
        pivot_df = result.pivot(index='weekday_number', columns='hour', values='message_count')

        # Verifica o idioma e faz o mapeamento dos dias da semana de acordo
        weekdays = texts['Graph_6']['labels']['weekdays']
        weekday_mapping = {i: weekdays[i] for i in range(7)}
        pivot_df.index = pivot_df.index.map(weekday_mapping)

        # Create the activity heatmap using plotly.graph_objs
        fig = go.Figure(data=go.Heatmap(
            z=pivot_df.values,
            x=pivot_df.columns,
            y=pivot_df.index,
            colorscale='Greens',  # Mantendo a paleta de cores Greens
            zmin=0,
            zmax=pivot_df.values.max(),
            colorbar=dict(title=texts['Graph_6']['labels'].get('z', 'Message Count')),
            hovertemplate=(
                f"<b>{texts['Graph_6']['hover'].get('x', 'Hour')}:</b> %{{x}}<br>"
                f"<b>{texts['Graph_6']['hover'].get('y', 'Day')}:</b> %{{y}}<br>"
                f"<b>{texts['Graph_6']['hover'].get('z', 'Message Count')}:</b> %{{z}}<extra></extra>"
            )
        ))

        # Add annotations to each cell with the message count value
        annotations = []
        for i, weekday in enumerate(pivot_df.index):
            for j, hour in enumerate(pivot_df.columns):
                value = pivot_df.iloc[i, j]
                annotations.append(
                    dict(
                        x=hour,
                        y=weekday,
                        text=str(int(value)),  # Convert the value to an integer string
                        showarrow=False,
                        font=dict(
                            color='white' if value > (pivot_df.values.max() * 0.3) else 'black'  # Aumentando o limite para melhor visibilidade dos valores baixos
                        )
                    )
                )

        fig.update_layout(
            title=title,
            yaxis=dict(
                tickmode='array',
                tickvals=list(pivot_df.index),
                ticktext=list(pivot_df.index),
                title=texts['Graph_6']['labels'].get('y', 'Weekday')
            ),
            xaxis=dict(
                tickmode='array',
                tickvals=list(pivot_df.columns),
                title=texts['Graph_6']['labels'].get('x', 'Hour of Day')
            ),
            annotations=annotations
        )

        # Save the heatmap as an HTML file if save_as_file is True
        if save_as_file:
            self._create_graphs_folder()
            fig.write_html(f"{self._folder_name}/{file_name}.html")

        return fig

    def generate_first_last_message(self,
                                    save_as_file: bool = False,
                                    title: str = None,
                                    file_name: str = None,
                                    language: str = 'English 🇺🇸',
                                    start_date: str = None,
                                    end_date: str = None,
                                    ) -> plotly.graph_objs._figure.Figure:
        """
        Generates a grouped bar chart comparing the counts of first and last messages sent by each user.

        Parameters:
        - save_as_file (bool, optional): If True, saves the chart as an HTML file.
        - title (str, optional): Title of the grouped bar chart.
        - file_name (str, optional): Name of the HTML file if save_as_file is True.
        - language (str, optional): Language for localization. Default is 'English 🇺🇸'.
        - start_date (str, optional): Start date for filtering the data.
        - end_date (str, optional): End date for filtering the data.

        Returns:
        - plotly.graph_objs._figure.Figure: The generated grouped bar chart.
        """

        # Set default values for title and file_name if not provided
        texts = Utils.read_language_files(language)
        if not title: title = texts['Graph_7']['title']
        if not file_name: file_name = 'Comparison_of_First_and_Last_Messages_Count'
        filtered_df = Utils.check_and_apply_filter_dates(start_date, end_date, self.chat_dataframe)

        first_message_users = filtered_df.groupby(['date']).agg({'who_sended': 'first'})
        user_counts = first_message_users['who_sended'].value_counts()
        first_messages_df = pd.DataFrame({'user': user_counts.index, texts['Graph_7']['dataframe_columns']['first']: user_counts.values})

        last_message_users = filtered_df.groupby(['date']).agg({'who_sended': 'last'})
        user_counts = last_message_users['who_sended'].value_counts()
        last_messages_df = pd.DataFrame({'user': user_counts.index, texts['Graph_7']['dataframe_columns']['last']: user_counts.values})

        # Merge the two DataFrames on the 'user' column
        merged_df = pd.merge(first_messages_df, last_messages_df, on='user', suffixes=('_first', '_last'))
        fig = px.bar(merged_df, x='user', y=[texts['Graph_7']['dataframe_columns']['first'], texts['Graph_7']['dataframe_columns']['last']],
                     labels={texts['Graph_7']['dataframe_columns']['first']: 'First Messages', texts['Graph_7']['dataframe_columns']['last']: 'Last Messages'},
                     title=title,
                     color_discrete_map={texts['Graph_7']['dataframe_columns']['first']: self.hex['main_wpp_5'],
                                         texts['Graph_7']['dataframe_columns']['last']: self.hex['main_wpp_1']})

        fig.update_layout(barmode='group',
                          xaxis_title=texts['Graph_7']['labels']['xaxis_title'],
                          yaxis_title=texts['Graph_7']['labels']['yaxis_title'],
                          legend_title=texts['Graph_7']['labels']['legend_title'])

        if not save_as_file: return fig

        self._create_graphs_folder()
        fig.write_html(f"{self._folder_name}/{file_name}.html")

    def count_word_occurrences(self,
                               word: str) -> int:
        """
        Count the occurrences of a word in the 'message' column of the WhatsApp conversation data.

        Parameters:
        - word (str): The word to count occurrences for.

        Returns:
        - int: The number of occurrences of the word in the 'message' column.
        """
        # Ensure 'message' column is of type string
        self.chat_dataframe['message'] = self.chat_dataframe['message'].astype(str)

        # Count occurrences of the word in the 'message' column
        return self.chat_dataframe['message'].str.lower().str.count(word.lower()).sum()

    def count_word_occurrences_by_person(self,
                                         word: str) -> pd.DataFrame:
        """
        Count the occurrences of a word in the 'message' column of the WhatsApp conversation data for each person.

        Parameters:
        - word (str): The word to count occurrences for.

        Returns:
        - pd.DataFrame: A dataframe where the index (username) starts from 1 and values are the number of occurrences of the word.
        """

        # Count occurrences of the word in the 'message' column for each person
        word_counts_by_person = self.chat_dataframe.groupby('who_sended')['message'].apply(lambda x: x.str.lower().str.count(word.lower()).sum())

        # Reset index starting from 1
        result_df = pd.DataFrame(word_counts_by_person).sort_values(by=['message'], ascending=False).reset_index()
        result_df.index += 1  # Add 1 to the index
        return result_df

    def display_dataframe(self,
                          language: str = 'English 🇺🇸',
                          start_date: str = None,
                          end_date: str = None):

        texts = Utils.read_language_files(language)
        filtered_df = Utils.check_and_apply_filter_dates(start_date, end_date, self.chat_dataframe)
        if language == 'Português 🇧🇷': filtered_df['weekday'] = filtered_df['weekday'].map(self.weekdays_translation)

        return filtered_df[['timestamp', 'who_sended', 'message', 'message_type', 'weekday']].rename(columns=texts['dataframe_columns'])
