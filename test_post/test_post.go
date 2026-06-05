package main

import (
	"fmt"
	"github.com/mattermost/mattermost/server/public/model"
)

func main() {
	post := &model.Post{
		Id: model.NewId(),
		UserId: model.NewId(),
		ChannelId: model.NewId(),
		Message: "Test",
		CreateAt: 123456789,
		UpdateAt: 123456789,
		FileIds: []string{},
	}
	for i := 0; i < 10; i++ {
		post.FileIds = append(post.FileIds, model.NewId())
	}
	
	err := post.IsValid(4000)
	if err != nil {
		fmt.Printf("Error with 10 files: %v\n", err)
	} else {
		fmt.Println("10 files is valid!")
	}
	
	post.FileIds = append(post.FileIds, model.NewId())
	err = post.IsValid(4000)
	if err != nil {
		fmt.Printf("Error with 11 files: %v\n", err)
	} else {
		fmt.Println("11 files is valid!")
	}
}
